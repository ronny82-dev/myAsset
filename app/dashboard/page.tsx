'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

interface Asset {
  id: string;
  name: string;
  type: 'CASH' | 'BANK' | 'CARD' | 'INVESTMENT';
  balance: number;
  is_active?: boolean;
}

interface CategoryStat {
  name: string;
  total: number;
}

interface MemberStat {
  nickname: string;
  total: number;
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  CASH: '현금',
  BANK: '은행',
  CARD: '카드',
  INVESTMENT: '투자',
};

const ASSET_TYPE_COLOR: Record<string, string> = {
  CASH: 'bg-green-100 text-green-700',
  BANK: 'bg-blue-100 text-blue-700',
  CARD: 'bg-red-100 text-red-600',
  INVESTMENT: 'bg-purple-100 text-purple-700',
};

export default function DashboardPage() {
  const router = useRouter();
  const { group, loading: groupLoading } = useGroup();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login');
    });
  }, []);

  useEffect(() => {
    if (groupLoading) return;
    fetchData();
  }, [selectedMonth, groupLoading]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [y, m] = selectedMonth.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1).toISOString();
      const endDate = new Date(y, m, 0, 23, 59, 59).toISOString();

      const [assetsRes, txRes] = await Promise.all([
        supabase.from('assets').select('id, name, type, balance, is_active').eq('is_active', true),
        supabase
          .from('transactions')
          .select('amount, type, transacted_at, categories(name), users(nickname)')
          .gte('transacted_at', startDate)
          .lte('transacted_at', endDate)
          .eq('is_deleted', false),
      ]);

      if (assetsRes.data) setAssets(assetsRes.data as Asset[]);

      if (txRes.data) {
        const expenses = txRes.data.filter((t: any) => t.type === 'EXPENSE');

        // 카테고리별 집계
        const catMap: Record<string, number> = {};
        for (const tx of expenses) {
          const name = (tx as any).categories?.name ?? '미분류';
          catMap[name] = (catMap[name] ?? 0) + tx.amount;
        }
        setCategoryStats(
          Object.entries(catMap)
            .map(([name, total]) => ({ name, total }))
            .sort((a, b) => b.total - a.total)
        );

        // 멤버별 집계
        const memberMap: Record<string, number> = {};
        for (const tx of expenses) {
          const name = (tx as any).users?.nickname ?? '알 수 없음';
          memberMap[name] = (memberMap[name] ?? 0) + tx.amount;
        }
        setMemberStats(
          Object.entries(memberMap).map(([nickname, total]) => ({ nickname, total }))
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const netWorth = assets
    .filter((a) => a.type !== 'CARD')
    .reduce((s, a) => s + (a.balance ?? 0), 0);

  const totalExpense = categoryStats.reduce((s, c) => s + c.total, 0);
  const maxCat = categoryStats[0]?.total ?? 1;

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="font-bold text-gray-800">대시보드</h1>
        {group && <p className="text-xs text-gray-400 mt-0.5">{group.name}</p>}
      </header>

      <main className="px-4 py-6 space-y-4 max-w-lg mx-auto">
        {/* 순자산 카드 */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-200">
          <p className="text-blue-100 text-sm mb-1">총 순자산</p>
          <p className="text-3xl font-bold">{netWorth.toLocaleString('ko-KR')}원</p>
          <div className="mt-4 flex gap-2 flex-wrap">
            {(['CASH', 'BANK', 'INVESTMENT'] as const).map((type) => {
              const sum = assets.filter((a) => a.type === type).reduce((s, a) => s + (a.balance ?? 0), 0);
              if (sum === 0) return null;
              return (
                <span key={type} className="text-xs bg-white/20 rounded-full px-3 py-1">
                  {ASSET_TYPE_LABEL[type]} {sum.toLocaleString('ko-KR')}원
                </span>
              );
            })}
          </div>
        </div>

        {/* 자산 목록 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">자산 현황</h2>
          </div>
          {loading ? (
            <div className="py-6 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {assets.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ASSET_TYPE_COLOR[asset.type]}`}>
                      {ASSET_TYPE_LABEL[asset.type]}
                    </span>
                    <span className="text-sm text-gray-700">{asset.name}</span>
                  </div>
                  <span className={`text-sm font-semibold ${asset.type === 'CARD' ? 'text-red-500' : 'text-gray-800'}`}>
                    {(asset.balance ?? 0).toLocaleString('ko-KR')}원
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 월 선택 + 지출 분석 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">월별 지출 분석</h2>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-sm text-gray-500 bg-transparent focus:outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>{m.replace('-', '년 ')}월</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="py-6 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : totalExpense === 0 ? (
            <div className="py-6 text-center text-gray-400 text-sm">이 달의 지출 내역이 없습니다.</div>
          ) : (
            <div className="px-4 py-4 space-y-3">
              <p className="text-xs text-gray-400">총 지출 <span className="text-red-500 font-semibold">{totalExpense.toLocaleString('ko-KR')}원</span></p>
              {categoryStats.map(({ name, total }) => (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">{name}</span>
                    <span className="text-gray-500">{total.toLocaleString('ko-KR')}원</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${(total / maxCat) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 커플 기여도 */}
        {memberStats.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">누가 더 썼을까?</h2>
            </div>
            <div className="px-4 py-4">
              <div className="flex rounded-full overflow-hidden h-4 mb-4">
                {memberStats.map(({ nickname, total }, i) => (
                  <div
                    key={nickname}
                    className={i === 0 ? 'bg-blue-500' : 'bg-pink-400'}
                    style={{ width: `${(total / totalExpense) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between">
                {memberStats.map(({ nickname, total }, i) => (
                  <div key={nickname} className="text-center">
                    <div className={`inline-block w-2 h-2 rounded-full mr-1 ${i === 0 ? 'bg-blue-500' : 'bg-pink-400'}`} />
                    <span className="text-sm text-gray-700">{nickname}</span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {total.toLocaleString('ko-KR')}원 ({Math.round((total / totalExpense) * 100)}%)
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
