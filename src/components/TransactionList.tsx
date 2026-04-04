'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

interface Transaction {
  id: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'BUY' | 'SELL';
  amount: number;
  transacted_at: string;
  description: string | null;
  categories: { name: string } | null;
  assets: { name: string } | null;
  users: { nickname: string; id: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  INCOME: '수입', EXPENSE: '지출', TRANSFER: '이체', BUY: '매수', SELL: '매도',
};
const TYPE_COLOR: Record<string, string> = {
  INCOME: 'text-green-600', EXPENSE: 'text-red-500',
  TRANSFER: 'text-blue-500', BUY: 'text-purple-500', SELL: 'text-orange-500',
};

export default function TransactionList() {
  const { members } = useGroup();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedMember, setSelectedMember] = useState<string>('all');

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchTransactions = async () => {
    setLoading(true);
    const [y, m] = selectedMonth.split('-').map(Number);
    const startDate = new Date(y, m - 1, 1).toISOString();
    const endDate = new Date(y, m, 0, 23, 59, 59).toISOString();

    let query = supabase
      .from('transactions')
      .select('id, type, amount, transacted_at, description, categories(name), assets(name), users(nickname, id)')
      .eq('is_deleted', false)
      .gte('transacted_at', startDate)
      .lte('transacted_at', endDate)
      .order('transacted_at', { ascending: false });

    if (selectedMember !== 'all') {
      query = query.eq('user_id', selectedMember);
    }

    const { data, error } = await query.limit(200);
    if (!error && data) setTransactions(data as unknown as Transaction[]);
    setLoading(false);
  };

  useEffect(() => { fetchTransactions(); }, [selectedMonth, selectedMember]);

  useEffect(() => {
    const channel = supabase.channel('tx-list-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchTransactions)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const toLocalDateKey = (isoStr: string) => {
    const d = new Date(isoStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const grouped = transactions.reduce<Record<string, Transaction[]>>((acc, tx) => {
    const date = toLocalDateKey(tx.transacted_at);
    if (!acc[date]) acc[date] = [];
    acc[date].push(tx);
    return acc;
  }, {});

  const totalExpense = transactions.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
  const totalIncome = transactions.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);

  const formatDate = (d: string) => {
    const [, m, day] = d.split('-').map(Number);
    return `${m}월 ${day}일`;
  };

  const formatAmount = (type: string, amount: number) => {
    const sign = type === 'INCOME' ? '+' : type === 'EXPENSE' ? '-' : '';
    return `${sign}${amount.toLocaleString('ko-KR')}원`;
  };

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex gap-2">
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="flex-1 px-3 py-2 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {months.map((m) => (
            <option key={m} value={m}>{m.replace('-', '년 ')}월</option>
          ))}
        </select>
        {members.length > 1 && (
          <select
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            className="flex-1 px-3 py-2 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">전체</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.nickname}</option>
            ))}
          </select>
        )}
      </div>

      {/* 월간 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">이번 달 지출</p>
          <p className="text-lg font-bold text-red-500">-{totalExpense.toLocaleString('ko-KR')}원</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">이번 달 수입</p>
          <p className="text-lg font-bold text-green-600">+{totalIncome.toLocaleString('ko-KR')}원</p>
        </div>
      </div>

      {/* 거래 목록 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">불러오는 중...</div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">이 달의 거래 내역이 없습니다.</div>
      ) : (
        Object.entries(grouped).map(([date, txs]) => {
          const dayTotal = txs.reduce((sum, tx) => {
            if (tx.type === 'EXPENSE') return sum - tx.amount;
            if (tx.type === 'INCOME') return sum + tx.amount;
            return sum;
          }, 0);

          return (
            <div key={date}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-sm font-semibold text-gray-500">{formatDate(date)}</span>
                <span className={`text-sm font-semibold ${dayTotal >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {dayTotal >= 0 ? '+' : ''}{dayTotal.toLocaleString('ko-KR')}원
                </span>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                {txs.map((tx) => (
                  <div key={tx.id} className="flex items-center px-4 py-3 gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {tx.categories?.name ?? '미분류'}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full shrink-0">
                          {TYPE_LABEL[tx.type]}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                        <span>{tx.assets?.name ?? '-'}</span>
                        {tx.users?.nickname && <span>· {tx.users.nickname}</span>}
                        {tx.description && <span>· {tx.description}</span>}
                      </div>
                    </div>
                    <span className={`text-base font-bold shrink-0 ${TYPE_COLOR[tx.type]}`}>
                      {formatAmount(tx.type, tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
