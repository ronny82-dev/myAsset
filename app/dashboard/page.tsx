'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase';
import toast from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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

interface CatSummaryItem {
  name: string;
  amount: number;
}

interface CatDetailPoint {
  month: string;  // XAxis용 "MM"
  label: string;  // "YYYY년 M월"
  ym: string;     // "YYYY-MM"
  amount: number;
}

interface SubCatItem {
  id: number;
  name: string;
  amount: number;
}

interface TxDetailItem {
  id: string;
  transacted_at: string;
  amount: number;
  description: string | null;
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  CASH: '현금', BANK: '은행', CHECKING: '입출금', SAVINGS: '적금',
  DEPOSIT: '예금', INVESTMENT: '투자', STOCK: '주식', PENSION: '연금',
  INSURANCE: '보험', REAL_ESTATE: '부동산', LOAN: '대출', CARD: '신용카드', OTHER_LIABILITY: '기타부채',
};

const LIABILITY_TYPES = ['CARD', 'LOAN', 'OTHER_LIABILITY'];
const CAT_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#6b7280', '#ec4899', '#14b8a6'];

function formatWon(value: number) {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}만`;
  return `${value.toLocaleString('ko-KR')}`;
}

function buildCatMap(cats: { id: number; name: string; parent_id: number | null; is_system: boolean }[]) {
  const map: Record<number, { name: string; parent_id: number | null; is_system: boolean }> = {};
  for (const c of cats) map[c.id] = c;
  return map;
}

function getParentLabel(id: number, catMap: Record<number, { name: string; parent_id: number | null; is_system: boolean }>): string | null {
  const cat = catMap[id];
  if (!cat || cat.is_system) return null;
  if (cat.parent_id) {
    const parent = catMap[cat.parent_id];
    if (!parent || parent.is_system) return null;
    return parent.name;
  }
  return cat.name;
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

  // 카테고리별 지출 관련 state
  const [monthlyCatSummary, setMonthlyCatSummary] = useState<CatSummaryItem[]>([]);
  const [monthlyCatLoading, setMonthlyCatLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);       // 대분류
  const [subCatSummary, setSubCatSummary] = useState<SubCatItem[]>([]);
  const [subCatLoading, setSubCatLoading] = useState(false);
  const [selectedSubCat, setSelectedSubCat] = useState<SubCatItem | null>(null); // 소분류
  const [catDetailData, setCatDetailData] = useState<CatDetailPoint[]>([]);
  const [catDetailLoading, setCatDetailLoading] = useState(false);
  const [selectedDetailMonth, setSelectedDetailMonth] = useState<string | null>(null); // 월 상세
  const [txDetail, setTxDetail] = useState<TxDetailItem[]>([]);
  const [txDetailLoading, setTxDetailLoading] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const months = (() => {
    const result: string[] = [];
    const now = new Date();
    const end = now.getFullYear() * 12 + now.getMonth();
    const start = 2025 * 12 + 0;
    for (let t = end; t >= start; t--) {
      const y = Math.floor(t / 12);
      const m = t % 12 + 1;
      result.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    return result;
  })();

  useEffect(() => { fetchDashboardData(); }, [selectedMonth]);
  useEffect(() => { fetchChartData(); }, [selectedMonth]);
  useEffect(() => {
    setSelectedCat(null);
    setSelectedSubCat(null);
    setSelectedDetailMonth(null);
    fetchMonthlyCatSummary();
  }, [selectedMonth]);

  // 대분류 선택 → 소분류 목록 조회
  useEffect(() => {
    setSelectedSubCat(null);
    setSelectedDetailMonth(null);
    if (selectedCat) fetchSubCatSummary();
  }, [selectedCat]);

  // 소분류 선택 → 12개월 추이 조회
  useEffect(() => {
    setSelectedDetailMonth(null);
    if (selectedSubCat) fetchSubCatDetail(selectedSubCat.id, selectedMonth);
  }, [selectedSubCat, selectedMonth]);

  // 월 선택 → 거래 상세 조회
  useEffect(() => {
    if (selectedDetailMonth && selectedSubCat) fetchTxDetail(selectedSubCat.id, selectedDetailMonth);
  }, [selectedDetailMonth]);

  // 대분류 선택 시 해당 월의 소분류별 금액 조회
  const fetchSubCatSummary = async () => {
    setSubCatLoading(true);
    try {
      const [y, m] = selectedMonth.split('-').map(Number);
      const startDate = `${selectedMonth}-01`;
      const nm = new Date(y, m, 1);
      const exclusiveEnd = `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`;

      const [catRes, txRes] = await Promise.all([
        supabase.from('categories').select('id, name, parent_id, is_system'),
        supabase.from('transactions')
          .select('amount, category_id')
          .eq('type', 'EXPENSE')
          .eq('is_deleted', false)
          .gte('transacted_at', startDate)
          .lt('transacted_at', exclusiveEnd)
          .not('category_id', 'is', null)
          .limit(5000),
      ]);

      const cats = catRes.data ?? [];
      const catMap = buildCatMap(cats);
      const parent = cats.find(c => c.name === selectedCat && c.parent_id === null && !c.is_system);
      if (!parent) { setSubCatSummary([]); return; }

      const totals: Record<number, number> = {};
      for (const tx of txRes.data ?? []) {
        const cat = catMap[tx.category_id];
        if (!cat || cat.is_system) continue;
        if (cat.parent_id === parent.id) {
          totals[tx.category_id] = (totals[tx.category_id] ?? 0) + tx.amount;
        } else if (tx.category_id === parent.id) {
          totals[parent.id] = (totals[parent.id] ?? 0) + tx.amount;
        }
      }

      const subCats = cats.filter(c => c.parent_id === parent.id && !c.is_system);
      const result: SubCatItem[] = [];
      for (const s of subCats) {
        if ((totals[s.id] ?? 0) > 0) result.push({ id: s.id, name: s.name, amount: totals[s.id] });
      }
      if ((totals[parent.id] ?? 0) > 0) result.push({ id: parent.id, name: parent.name, amount: totals[parent.id] });
      result.sort((a, b) => b.amount - a.amount);
      setSubCatSummary(result);
    } finally {
      setSubCatLoading(false);
    }
  };

  // 소분류 선택 시 최근 12개월 추이 조회 (category_id 직접 매칭)
  const fetchSubCatDetail = useCallback(async (subCatId: number, baseMonth: string) => {
    setCatDetailLoading(true);
    try {
      const [selYear, selMonthNum] = baseMonth.split('-').map(Number);
      const trendMonths: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(selYear, selMonthNum - 1 - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym >= '2025-01') trendMonths.push(ym);
      }
      if (trendMonths.length === 0) return;

      const startDate = `${trendMonths[0]}-01`;
      const [ey, em] = trendMonths[trendMonths.length - 1].split('-').map(Number);
      const nextMonth = new Date(ey, em, 1);
      const exclusiveEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const { data } = await supabase
        .from('transactions')
        .select('amount, transacted_at')
        .eq('type', 'EXPENSE')
        .eq('is_deleted', false)
        .eq('category_id', subCatId)
        .gte('transacted_at', startDate)
        .lt('transacted_at', exclusiveEnd)
        .limit(5000);

      const byMonth: Record<string, number> = {};
      for (const ym of trendMonths) byMonth[ym] = 0;
      for (const tx of data ?? []) {
        const ym = (tx.transacted_at as string).slice(0, 7);
        if (ym in byMonth) byMonth[ym] += tx.amount;
      }

      setCatDetailData(trendMonths.map((ym) => {
        const [y, m] = ym.split('-').map(Number);
        return { month: ym.slice(5), label: `${y}년 ${m}월`, ym, amount: byMonth[ym] };
      }));
    } finally {
      setCatDetailLoading(false);
    }
  }, []);

  // 월 클릭 시 해당 소분류의 거래 상세 조회
  const fetchTxDetail = useCallback(async (subCatId: number, month: string) => {
    setTxDetailLoading(true);
    try {
      const [y, m] = month.split('-').map(Number);
      const startDate = `${month}-01`;
      const nm = new Date(y, m, 1);
      const exclusiveEnd = `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`;

      const { data } = await supabase
        .from('transactions')
        .select('id, transacted_at, amount, description')
        .eq('type', 'EXPENSE')
        .eq('is_deleted', false)
        .eq('category_id', subCatId)
        .gte('transacted_at', startDate)
        .lt('transacted_at', exclusiveEnd)
        .order('transacted_at', { ascending: false })
        .limit(200);

      setTxDetail(data ?? []);
    } finally {
      setTxDetailLoading(false);
    }
  }, []);

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

      const { data: cached } = await supabase
        .from('asset_monthly_balances')
        .select('asset_id, closing_balance')
        .in('asset_id', allAssets.map((a: any) => a.id))
        .eq('year_month', selectedMonth);

      const cachedMap: Record<string, number> = {};
      for (const row of cached ?? []) cachedMap[row.asset_id] = Number(row.closing_balance);

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
      const [selYear, selMonthNum] = selectedMonth.split('-').map(Number);
      const chartMonths: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(selYear, selMonthNum - 1 - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym >= '2025-01') chartMonths.push(ym);
      }
      const assetsRes = await supabase.from('assets').select('id, type, initial_balance').eq('is_active', true);
      if (!assetsRes.data) return;
      const allAssets = assetsRes.data;

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

  const fetchMonthlyCatSummary = async () => {
    setMonthlyCatLoading(true);
    try {
      const [y, m] = selectedMonth.split('-').map(Number);
      const startDate = `${selectedMonth}-01`;
      const nextMonth = new Date(y, m, 1);
      const exclusiveEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const [catRes, txRes] = await Promise.all([
        supabase.from('categories').select('id, name, parent_id, is_system'),
        supabase.from('transactions')
          .select('amount, category_id')
          .eq('type', 'EXPENSE')
          .eq('is_deleted', false)
          .gte('transacted_at', startDate)
          .lt('transacted_at', exclusiveEnd)
          .not('category_id', 'is', null)
          .limit(5000),
      ]);

      const catMap = buildCatMap(catRes.data ?? []);
      const totals: Record<string, number> = {};
      for (const tx of txRes.data ?? []) {
        const label = getParentLabel(tx.category_id, catMap);
        if (!label) continue;
        totals[label] = (totals[label] ?? 0) + tx.amount;
      }

      const sorted = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amount]) => ({ name, amount }));
      setMonthlyCatSummary(sorted);
    } finally {
      setMonthlyCatLoading(false);
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

  // Lv2: 소분류 목록
  const renderSubCatSummary = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const total = subCatSummary.reduce((s, c) => s + c.amount, 0);
    const max = Math.max(...subCatSummary.map(c => c.amount), 1);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedCat(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-sm font-bold text-gray-800">{selectedCat}</p>
            <p className="text-xs text-gray-400">{y}년 {m}월 소분류별 지출</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {subCatLoading ? (
            <div className="space-y-3 px-4 py-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse space-y-1.5">
                  <div className="flex justify-between"><div className="h-3.5 w-16 bg-gray-100 rounded" /><div className="h-3.5 w-20 bg-gray-100 rounded" /></div>
                  <div className="h-2 bg-gray-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : subCatSummary.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">소분류 지출 내역이 없습니다.</p>
          ) : (
            <>
              <div className="px-4 pt-3 pb-2 flex justify-between">
                <p className="text-sm font-bold text-gray-700">소분류</p>
                <p className="text-xs text-gray-400">합계 <span className="font-semibold text-gray-600">{total.toLocaleString('ko-KR')}원</span></p>
              </div>
              <div className="divide-y divide-gray-50">
                {subCatSummary.map(({ id, name, amount }, i) => {
                  const pct = Math.round((amount / max) * 100);
                  const color = CAT_COLORS[i % CAT_COLORS.length];
                  const sharePct = Math.round((amount / total) * 100);
                  return (
                    <button key={id} onClick={() => setSelectedSubCat({ id, name, amount })}
                      className="w-full px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm font-medium text-gray-800">{name}</span>
                          <span className="text-xs text-gray-400">{sharePct}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-semibold text-gray-800">{amount.toLocaleString('ko-KR')}원</span>
                          <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Lv3: 소분류 12개월 추이 + 월 클릭
  const renderCatDetail = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const reversedData = [...catDetailData].reverse();
    const totalAmount = catDetailData.reduce((s, d) => s + d.amount, 0);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedSubCat(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-xs text-gray-400">{selectedCat}</p>
            <p className="text-sm font-bold text-gray-800">{selectedSubCat?.name}</p>
            <p className="text-xs text-gray-400">최근 12개월 · 합계 {totalAmount.toLocaleString('ko-KR')}원</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-bold text-gray-500">월별 지출 추이</p>
          </div>
          {catDetailLoading ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={catDetailData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  onClick={(e: any) => {
                    const payload = e?.activePayload?.[0]?.payload;
                    if (payload?.amount > 0) setSelectedDetailMonth(payload.ym);
                  }}>
                  <defs>
                    <linearGradient id="catGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={formatWon} width={44} />
                  <Tooltip
                    formatter={(value) => [`${Number(value ?? 0).toLocaleString('ko-KR')}원`, selectedSubCat?.name ?? '']}
                    labelFormatter={(label) => `${label}월`}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2} fill="url(#catGrad)" dot={false} activeDot={{ r: 4, fill: '#3b82f6' }} />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-center text-xs text-gray-400 mt-1">월을 클릭하면 상세 내역을 확인할 수 있습니다</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-bold text-gray-500">월별 사용 금액 <span className="font-normal text-gray-400 ml-1">(클릭하면 상세 확인)</span></p>
          </div>
          {catDetailLoading ? (
            <div className="h-24 flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {reversedData.map((row) => {
                const isSelected = row.label === `${y}년 ${m}월`;
                return (
                  <button key={row.month} disabled={row.amount === 0}
                    onClick={() => setSelectedDetailMonth(row.ym)}
                    className={`w-full flex items-center justify-between px-4 py-3 transition-colors text-left
                      ${row.amount === 0 ? 'cursor-default' : 'hover:bg-gray-50 cursor-pointer'}
                      ${isSelected ? 'bg-blue-50' : ''}`}>
                    <span className={`text-sm ${isSelected ? 'font-bold text-blue-700' : 'text-gray-600'}`}>
                      {row.label}
                      {isSelected && <span className="ml-1.5 text-xs font-normal text-blue-400">선택월</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-semibold ${row.amount === 0 ? 'text-gray-300' : isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                        {row.amount === 0 ? '—' : `${row.amount.toLocaleString('ko-KR')}원`}
                      </span>
                      {row.amount > 0 && (
                        <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Lv4: 특정 월의 거래 상세 목록
  const renderTxDetail = () => {
    const ym = selectedDetailMonth ?? '';
    const [dy, dm] = ym.split('-').map(Number);
    const labelMonth = ym ? `${dy}년 ${dm}월` : '';
    const total = txDetail.reduce((s, t) => s + t.amount, 0);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedDetailMonth(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-xs text-gray-400">{selectedCat} · {selectedSubCat?.name}</p>
            <p className="text-sm font-bold text-gray-800">{labelMonth} 상세 내역</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex justify-between items-center">
            <p className="text-sm font-bold text-gray-700">{labelMonth}</p>
            {total > 0 && <p className="text-xs text-gray-400">합계 <span className="font-semibold text-gray-700">{total.toLocaleString('ko-KR')}원</span></p>}
          </div>
          {txDetailLoading ? (
            <div className="space-y-2 px-4 pb-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse flex justify-between py-2">
                  <div className="h-4 w-24 bg-gray-100 rounded" /><div className="h-4 w-20 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : txDetail.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">거래 내역이 없습니다.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {txDetail.map((tx) => {
                const dateStr = (tx.transacted_at as string).slice(0, 10);
                return (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-xs text-gray-400">{dateStr}</p>
                      <p className="text-sm text-gray-700 mt-0.5">{tx.description || '(메모 없음)'}</p>
                    </div>
                    <p className="text-sm font-semibold text-gray-800 ml-4 shrink-0">{tx.amount.toLocaleString('ko-KR')}원</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // 카테고리별 지출 탭 — 월간 요약 목록
  const renderMonthlySummary = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const totalAmount = monthlyCatSummary.reduce((s, c) => s + c.amount, 0);
    const maxAmount = Math.max(...monthlyCatSummary.map(c => c.amount), 1);

    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-700">{y}년 {m}월 카테고리별 지출</p>
          {totalAmount > 0 && (
            <p className="text-xs text-gray-400">합계 <span className="font-semibold text-gray-600">{totalAmount.toLocaleString('ko-KR')}원</span></p>
          )}
        </div>

        {monthlyCatLoading ? (
          <div className="space-y-3 px-4 pb-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="flex justify-between">
                  <div className="h-3.5 w-16 bg-gray-100 rounded" />
                  <div className="h-3.5 w-20 bg-gray-100 rounded" />
                </div>
                <div className="h-2 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : monthlyCatSummary.length === 0 ? (
          <div className="py-10 flex items-center justify-center text-gray-400 text-sm">
            지출 내역이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {monthlyCatSummary.map(({ name, amount }, i) => {
              const pct = Math.round((amount / maxAmount) * 100);
              const color = CAT_COLORS[i % CAT_COLORS.length];
              const sharePct = Math.round((amount / totalAmount) * 100);
              return (
                <button
                  key={name}
                  onClick={() => setSelectedCat(name)}
                  className="w-full px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-sm font-medium text-gray-800">{name}</span>
                      <span className="text-xs text-gray-400">{sharePct}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-gray-800">{amount.toLocaleString('ko-KR')}원</span>
                      <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
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
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={formatWon} width={46} />
                    <Tooltip
                      formatter={(value) => [`${Number(value ?? 0).toLocaleString('ko-KR')}원`, '순자산']}
                      labelFormatter={(label) => `${label}월`}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Area type="monotone" dataKey="netWorth" stroke="#2563eb" strokeWidth={2} fill="url(#netWorthGrad)" dot={false} activeDot={{ r: 4, fill: '#2563eb' }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        {/* 탭 */}
        <div>
          <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
            <button
              onClick={() => switchTab('spending')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'spending' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              카테고리별 지출
            </button>
            <button
              onClick={() => switchTab('assets')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'assets' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              자산 / 부채
            </button>
          </div>

          {/* 탭 콘텐츠 — 카테고리별 지출 (4단계 드릴다운) */}
          {activeTab === 'spending' && (() => {
            if (!selectedCat) return renderMonthlySummary();
            if (!selectedSubCat) return renderSubCatSummary();
            if (!selectedDetailMonth) return renderCatDetail();
            return renderTxDetail();
          })()}

          {/* 탭 콘텐츠 — 자산 / 부채 */}
          {activeTab === 'assets' && (
            <div className="space-y-6">
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
