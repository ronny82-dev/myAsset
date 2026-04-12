'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase';
import toast from 'react-hot-toast';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getClosingBalance, populateAllBalances } from '@/utils/monthlyBalance';

interface Asset {
  id: string;
  name: string;
  type: string;
  balance: number;
}

interface ChartPoint {
  month: string;
  netWorth: number;
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  CASH: '현금', BANK: '은행', CHECKING: '입출금', SAVINGS: '적금',
  DEPOSIT: '예금', INVESTMENT: '투자', STOCK: '주식', PENSION: '연금',
  INSURANCE: '보험', REAL_ESTATE: '부동산', LOAN: '대출', CARD: '신용카드', OTHER_LIABILITY: '기타부채',
};

const LIABILITY_TYPES = ['CARD', 'LOAN', 'OTHER_LIABILITY'];

const TOP_CAT_N = 5;
const CAT_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#6b7280'];

interface CategoryTrendPoint {
  month: string;
  [key: string]: number | string;
}

function formatWon(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(0)}만`;
  }
  return `${value.toLocaleString('ko-KR')}`;
}

export default function DashboardPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [showChart, setShowChart] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('dashboard_showChart');
    return stored === null ? true : stored === 'true';
  });
  const [showAssets, setShowAssets] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('dashboard_showAssets') !== 'false';
  });
  const [showLiabilities, setShowLiabilities] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('dashboard_showLiabilities') !== 'false';
  });
  const [activeTab, setActiveTab] = useState<'spending' | 'assets'>(() => {
    if (typeof window === 'undefined') return 'spending';
    return (localStorage.getItem('dashboard_activeTab') as 'spending' | 'assets') ?? 'spending';
  });
  const [categoryTrendData, setCategoryTrendData] = useState<CategoryTrendPoint[]>([]);
  const [topCategories, setTopCategories] = useState<string[]>([]);
  const [hasOthers, setHasOthers] = useState(false);
  const [categoryTrendLoading, setCategoryTrendLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

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
    fetchDashboardData();
  }, [selectedMonth]);

  useEffect(() => {
    fetchChartData();
  }, [selectedMonth]);

  useEffect(() => {
    fetchCategoryTrendData();
  }, [selectedMonth]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const assetsRes = await supabase
        .from('assets')
        .select('id, name, type, initial_balance')
        .eq('is_active', true)
        .order('type');
      if (!assetsRes.data) return;

      const allAssets = assetsRes.data;

      // 캐시에서 해당 월 잔액 일괄 조회
      const { data: cached } = await supabase
        .from('asset_monthly_balances')
        .select('asset_id, closing_balance')
        .in('asset_id', allAssets.map((a: any) => a.id))
        .eq('year_month', selectedMonth);

      const cachedMap: Record<string, number> = {};
      for (const row of cached ?? []) {
        cachedMap[row.asset_id] = Number(row.closing_balance);
      }

      // 캐시 없는 자산은 lazy 계산
      const adjustedAssets = await Promise.all(allAssets.map(async (a: any) => {
        const balance = cachedMap[a.id] !== undefined
          ? cachedMap[a.id]
          : await getClosingBalance(a.id, a.type, a.initial_balance ?? 0, selectedMonth);
        return { ...a, balance };
      }));

      setAssets(adjustedAssets);
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async () => {
    setChartLoading(true);
    try {
      // 조회월 기준 최대 12개월, 2025-01 미만은 제외
      const [selYear, selMonthNum] = selectedMonth.split('-').map(Number);
      const chartMonths: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(selYear, selMonthNum - 1 - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym >= '2025-01') chartMonths.push(ym);
      }

      const assetsRes = await supabase
        .from('assets')
        .select('id, type, initial_balance')
        .eq('is_active', true);
      if (!assetsRes.data) return;

      const allAssets = assetsRes.data;

      // 12개월치 캐시 일괄 조회
      const { data: cached } = await supabase
        .from('asset_monthly_balances')
        .select('asset_id, year_month, closing_balance')
        .in('asset_id', allAssets.map((a: any) => a.id))
        .in('year_month', chartMonths);

      const cacheMap: Record<string, Record<string, number>> = {};
      for (const row of cached ?? []) {
        if (!cacheMap[row.asset_id]) cacheMap[row.asset_id] = {};
        cacheMap[row.asset_id][row.year_month] = Number(row.closing_balance);
      }

      const data: ChartPoint[] = await Promise.all(chartMonths.map(async (month) => {
        const balances = await Promise.all(allAssets.map(async (a: any) => {
          const bal = cacheMap[a.id]?.[month] !== undefined
            ? cacheMap[a.id][month]
            : await getClosingBalance(a.id, a.type, a.initial_balance ?? 0, month);
          return { type: a.type, balance: bal };
        }));

        const netWorth = balances.reduce((sum, { type, balance }) =>
          LIABILITY_TYPES.includes(type) ? sum - Math.abs(balance) : sum + balance, 0);

        return { month: month.slice(5), netWorth };
      }));

      setChartData(data);
    } finally {
      setChartLoading(false);
    }
  };

  const fetchCategoryTrendData = async () => {
    setCategoryTrendLoading(true);
    try {
      const [selYear, selMonthNum] = selectedMonth.split('-').map(Number);
      const trendMonths: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(selYear, selMonthNum - 1 - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym >= '2025-01') trendMonths.push(ym);
      }
      if (trendMonths.length === 0) return;

      const startDate = `${trendMonths[0]}-01T00:00:00+09:00`;
      const [ey, em] = trendMonths[trendMonths.length - 1].split('-').map(Number);
      const endDate = `${trendMonths[trendMonths.length - 1]}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}T23:59:59+09:00`;

      const [catRes, txRes] = await Promise.all([
        supabase.from('categories').select('id, name, parent_id, is_system'),
        supabase.from('transactions')
          .select('amount, category_id, transacted_at')
          .eq('type', 'EXPENSE')
          .eq('is_deleted', false)
          .gte('transacted_at', startDate)
          .lte('transacted_at', endDate)
          .not('category_id', 'is', null),
      ]);

      const cats = catRes.data ?? [];
      const catMap: Record<number, { name: string; parent_id: number | null; is_system: boolean }> = {};
      for (const c of cats) catMap[c.id] = c;

      // 시스템 카테고리 제외, 부모 카테고리명으로 그룹핑
      const getLabel = (id: number): string | null => {
        const cat = catMap[id];
        if (!cat || cat.is_system) return null;
        if (cat.parent_id) {
          const parent = catMap[cat.parent_id];
          if (!parent || parent.is_system) return null;
          return parent.name;
        }
        return cat.name;
      };

      // 월별 카테고리 합산
      const byMonthCat: Record<string, Record<string, number>> = {};
      for (const ym of trendMonths) byMonthCat[ym] = {};

      for (const tx of txRes.data ?? []) {
        const d = new Date(tx.transacted_at);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonthCat[ym]) continue;
        const label = getLabel(tx.category_id);
        if (!label) continue;
        byMonthCat[ym][label] = (byMonthCat[ym][label] ?? 0) + tx.amount;
      }

      // 전체 기간 카테고리 합산 → 상위 N개 선정
      const totals: Record<string, number> = {};
      for (const ym of trendMonths) {
        for (const [cat, amt] of Object.entries(byMonthCat[ym])) {
          totals[cat] = (totals[cat] ?? 0) + amt;
        }
      }
      const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, TOP_CAT_N).map(([name]) => name);
      const othersExist = sorted.length > TOP_CAT_N;

      // 차트 데이터 빌드
      const data: CategoryTrendPoint[] = trendMonths.map((ym) => {
        const point: CategoryTrendPoint = { month: ym.slice(5) };
        let others = 0;
        for (const [cat, amt] of Object.entries(byMonthCat[ym])) {
          if (top.includes(cat)) point[cat] = amt;
          else others += amt;
        }
        if (othersExist && others > 0) point['기타'] = others;
        return point;
      });

      setTopCategories(top);
      setHasOthers(othersExist);
      setCategoryTrendData(data);
    } finally {
      setCategoryTrendLoading(false);
    }
  };

  const toggleChart = () => {
    const next = !showChart;
    setShowChart(next);
    localStorage.setItem('dashboard_showChart', String(next));
  };

  const switchTab = (tab: 'spending' | 'assets') => {
    setActiveTab(tab);
    localStorage.setItem('dashboard_activeTab', tab);
  };

  const recalculateBalances = async () => {
    if (!confirm('모든 자산의 잔액을 거래 내역 기준으로 재계산합니다. 계속하시겠습니까?')) return;
    setRecalculating(true);
    try {
      await populateAllBalances();
      toast.success('잔액 재계산이 완료되었습니다.');
      fetchDashboardData();
      fetchChartData();
    } catch (e: any) {
      toast.error(`재계산 실패: ${e.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  const positiveAssets = assets.filter(a => !LIABILITY_TYPES.includes(a.type));
  const liabilityAssets = assets.filter(a => LIABILITY_TYPES.includes(a.type) && a.type !== 'CARD');

  const positiveTotal = positiveAssets.reduce((sum, a) => sum + a.balance, 0);
  const liabilityTotal = liabilityAssets.reduce((sum, a) => sum + Math.abs(a.balance), 0);
  const totalBalance = positiveTotal - liabilityTotal;

  const toggleAssets = () => {
    const next = !showAssets;
    setShowAssets(next);
    localStorage.setItem('dashboard_showAssets', String(next));
  };

  const toggleLiabilities = () => {
    const next = !showLiabilities;
    setShowLiabilities(next);
    localStorage.setItem('dashboard_showLiabilities', String(next));
  };

  const renderAssetGrid = (assetList: Asset[], isLiability: boolean) => {
    if (loading) {
      return (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm animate-pulse flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-5 w-12 bg-gray-100 rounded-md" />
                <div className="h-4 w-24 bg-gray-100 rounded" />
              </div>
              <div className="h-5 w-20 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      );
    }
    if (assetList.length === 0) {
      return <p className="text-center text-gray-400 text-sm py-6">등록된 내역이 없습니다.</p>;
    }
    return (
      <div className="flex flex-col gap-2">
        {assetList.map((asset) => (
          <Link
            key={asset.id}
            href={`/assets/${asset.id}?month=${selectedMonth}`}
            className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md ${
                isLiability ? 'bg-red-50 text-red-400' : 'bg-blue-50 text-blue-400'
              }`}>
                {ASSET_TYPE_LABEL[asset.type] || asset.type}
              </span>
              <span className="text-sm font-semibold text-gray-800 truncate">{asset.name}</span>
            </div>
            <span className={`shrink-0 text-sm font-bold ml-4 ${isLiability ? 'text-red-500' : 'text-gray-900'}`}>
              {isLiability ? '-' : ''}{Math.abs(asset.balance).toLocaleString('ko-KR')}원
            </span>
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-gray-800 text-lg">대시보드</h1>
          <button
            onClick={recalculateBalances}
            disabled={recalculating}
            className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors px-1"
            title="거래 내역 기준으로 잔액 재계산"
          >
            {recalculating ? '재계산 중…' : '↺ 재계산'}
          </button>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="text-sm font-medium text-gray-600 bg-gray-100 rounded-lg px-3 py-1.5 focus:outline-none cursor-pointer"
        >
          {months.map((m) => (
            <option key={m} value={m}>{m.replace('-', '년 ')}월</option>
          ))}
        </select>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* 총 자산 요약 */}
        <div className="bg-blue-600 rounded-2xl p-5 shadow-lg shadow-blue-200 text-white">
          <p className="text-blue-100 text-sm mb-1">순자산 총액</p>
          <p className="text-3xl font-bold mb-4">{totalBalance.toLocaleString('ko-KR')}원</p>
          <div className="flex justify-between">
            <div>
              <p className="text-blue-200 text-xs mb-0.5">자산</p>
              <p className="text-lg font-semibold">{positiveTotal.toLocaleString('ko-KR')}원</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-xs mb-0.5">부채</p>
              <p className="text-lg font-semibold">{liabilityTotal.toLocaleString('ko-KR')}원</p>
            </div>
          </div>
        </div>

        {/* 순자산 추이 그래프 */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <button
            onClick={toggleChart}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-bold text-gray-700">순자산 추이 (최근 1년)</span>
            <span className="text-xs text-gray-400">{showChart ? '숨기기 ▲' : '보기 ▼'}</span>
          </button>

          {showChart && (
            <div className="px-2 pb-4">
              {chartLoading ? (
                <div className="h-40 flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={formatWon}
                      width={46}
                    />
                    <Tooltip
                      formatter={(value) => [`${Number(value ?? 0).toLocaleString('ko-KR')}원`, '순자산']}
                      labelFormatter={(label) => `${label}월`}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="netWorth"
                      stroke="#2563eb"
                      strokeWidth={2}
                      fill="url(#netWorthGrad)"
                      dot={false}
                      activeDot={{ r: 4, fill: '#2563eb' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        {/* 탭 */}
        <div>
          {/* 탭 헤더 */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
            <button
              onClick={() => switchTab('spending')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'spending'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              카테고리별 지출
            </button>
            <button
              onClick={() => switchTab('assets')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'assets'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              자산 / 부채
            </button>
          </div>

          {/* 탭 콘텐츠 — 카테고리별 지출 */}
          {activeTab === 'spending' && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="px-4 pt-3 pb-1">
                <p className="text-sm font-bold text-gray-700">카테고리별 지출 추이 <span className="text-xs font-normal text-gray-400">(최근 6개월)</span></p>
              </div>
              <div className="pb-4">
                {categoryTrendLoading ? (
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
                ) : categoryTrendData.length === 0 ? (
                  <div className="h-24 flex items-center justify-center text-gray-400 text-sm">지출 내역이 없습니다.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={categoryTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={formatWon} width={46} />
                      <Tooltip
                        formatter={(value, name) => [`${Number(value ?? 0).toLocaleString('ko-KR')}원`, name]}
                        labelFormatter={(label) => `${label}월`}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />
                      {topCategories.map((cat, i) => (
                        <Bar
                          key={cat} dataKey={cat} stackId="a"
                          fill={CAT_COLORS[i % CAT_COLORS.length]}
                          radius={i === topCategories.length - 1 && !hasOthers ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                      {hasOthers && <Bar dataKey="기타" stackId="a" fill={CAT_COLORS[5]} radius={[3, 3, 0, 0]} />}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* 탭 콘텐츠 — 자산 / 부채 */}
          {activeTab === 'assets' && (
            <div className="space-y-6">
              {/* 자산 */}
              <div>
                <button onClick={toggleAssets} className="w-full flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-700">자산</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-blue-600">{positiveTotal.toLocaleString('ko-KR')}원</span>
                    <span className="text-xs text-gray-400">{showAssets ? '▲' : '▼'}</span>
                  </div>
                </button>
                {showAssets && renderAssetGrid(positiveAssets, false)}
              </div>

              {/* 부채 */}
              {(liabilityAssets.length > 0 || loading) && (
                <div>
                  <button onClick={toggleLiabilities} className="w-full flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-gray-700">부채</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-red-500">{liabilityTotal.toLocaleString('ko-KR')}원</span>
                      <span className="text-xs text-gray-400">{showLiabilities ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {showLiabilities && renderAssetGrid(liabilityAssets, true)}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
