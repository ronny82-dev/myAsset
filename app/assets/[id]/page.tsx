'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { getClosingBalance } from '@/utils/monthlyBalance';

interface Asset {
  id: string;
  name: string;
  type: string;
  balance: number;
  initial_balance: number;
}

interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

interface Transaction {
  id: number;
  type: string;
  amount: number;
  transacted_at: string;
  description: string | null;
  category_id: number | null;
  users: { nickname: string }[] | null;
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  CASH: '현금', BANK: '은행', CHECKING: '입출금', SAVINGS: '적금',
  DEPOSIT: '예금', INVESTMENT: '투자', STOCK: '주식', PENSION: '연금',
  INSURANCE: '보험', REAL_ESTATE: '부동산', LOAN: '대출', CARD: '신용카드', OTHER_LIABILITY: '기타부채',
};

const LIABILITY_TYPES = ['CARD', 'LOAN', 'OTHER_LIABILITY'];

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialMonth = searchParams.get('month') ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [monthEndBalance, setMonthEndBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const months = (() => {
    const result: string[] = [];
    const now = new Date();
    const end = now.getFullYear() * 12 + now.getMonth();
    const start = 2025 * 12 + 0; // 2025-01
    for (let t = end; t >= start; t--) {
      const y = Math.floor(t / 12);
      const m = t % 12 + 1;
      result.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    return result;
  })();

  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name, parent_id')
      .then(({ data }) => { if (data) setCategories(data as Category[]); });
  }, []);

  useEffect(() => {
    fetchData();
  }, [id, selectedMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [y, m] = selectedMonth.split('-').map(Number);
      const endDate = new Date(y, m, 0, 23, 59, 59);
      const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T23:59:59+09:00`;
      const startDateStr = `${y}-${String(m).padStart(2, '0')}-01T00:00:00+09:00`;

      const [assetRes, monthTxRes] = await Promise.all([
        supabase.from('assets').select('id, name, type, balance, initial_balance').eq('id', id).single(),
        // 해당 월 거래 내역 표시용
        supabase.from('transactions')
          .select('id, type, amount, transacted_at, description, category_id, users(nickname)')
          .eq('asset_id', id)
          .eq('is_deleted', false)
          .gte('transacted_at', startDateStr)
          .lte('transacted_at', endDateStr)
          .order('transacted_at', { ascending: false }),
      ]);

      if (assetRes.data) {
        const a = assetRes.data as Asset;
        setAsset(a);
        const closing = await getClosingBalance(a.id, a.type, a.initial_balance ?? 0, selectedMonth);
        setMonthEndBalance(closing);
      }

      if (monthTxRes.data) {
        setTransactions(monthTxRes.data as Transaction[]);
      }
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (categoryId: number | null): string => {
    if (!categoryId) return '-';
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return '-';
    if (cat.parent_id) {
      const parent = categories.find(c => c.id === cat.parent_id);
      return parent ? `${parent.name} › ${cat.name}` : cat.name;
    }
    return cat.name;
  };

  const isLiability = asset ? LIABILITY_TYPES.includes(asset.type) : false;

  const monthIncome = transactions.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
  const monthExpense = transactions.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    router.replace(`/assets/${id}?month=${month}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          {asset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                {ASSET_TYPE_LABEL[asset.type] || asset.type}
              </span>
              <h1 className="font-bold text-gray-800">{asset.name}</h1>
            </div>
          ) : (
            <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
          )}
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => handleMonthChange(e.target.value)}
          className="text-sm font-medium text-gray-600 bg-gray-100 rounded-lg px-3 py-1.5 focus:outline-none cursor-pointer"
        >
          {months.map((mo) => (
            <option key={mo} value={mo}>{mo.replace('-', '년 ')}월</option>
          ))}
        </select>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto space-y-4">
        {/* 잔액 요약 */}
        <div className={`rounded-2xl p-5 shadow-lg text-white ${isLiability ? 'bg-red-500 shadow-red-200' : 'bg-blue-600 shadow-blue-200'}`}>
          <p className="text-sm opacity-80 mb-1">{selectedMonth.replace('-', '년 ')}월 말 잔액</p>
          {monthEndBalance !== null ? (
            <p className="text-3xl font-bold">
              {isLiability ? '-' : ''}{Math.abs(monthEndBalance).toLocaleString('ko-KR')}원
            </p>
          ) : (
            <div className="h-9 w-40 bg-white/20 rounded-lg animate-pulse mt-1" />
          )}
          {!isLiability && (
            <div className="flex gap-4 mt-3 text-sm opacity-80">
              <span>수입 +{monthIncome.toLocaleString('ko-KR')}원</span>
              <span>지출 -{monthExpense.toLocaleString('ko-KR')}원</span>
            </div>
          )}
          {isLiability && (
            <div className="flex gap-4 mt-3 text-sm opacity-80">
              <span>결제 -{monthExpense.toLocaleString('ko-KR')}원</span>
              <span>입금 +{monthIncome.toLocaleString('ko-KR')}원</span>
            </div>
          )}
        </div>

        {/* 거래 내역 */}
        <div>
          <h2 className="text-sm font-bold text-gray-700 mb-3">
            거래 내역 {!loading && <span className="font-normal text-gray-400">({transactions.length}건)</span>}
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">불러오는 중...</div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">이 달의 거래 내역이 없습니다.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {transactions.map((tx) => {
                  const isExpense = tx.type === 'EXPENSE';
                  const isIncome = tx.type === 'INCOME';
                  const date = new Date(tx.transacted_at);
                  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
                  return (
                    <div key={tx.id} className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-400 w-8 shrink-0">{dateStr}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {tx.description || getCategoryLabel(tx.category_id)}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {getCategoryLabel(tx.category_id)}
                            {tx.users?.[0]?.nickname && ` · ${tx.users[0].nickname}`}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ml-3 shrink-0 ${isExpense ? 'text-red-500' : isIncome ? 'text-blue-600' : 'text-gray-600'}`}>
                        {isExpense ? '-' : isIncome ? '+' : ''}{tx.amount.toLocaleString('ko-KR')}원
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
