'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/utils/supabase';
import { invalidateFrom } from '@/utils/monthlyBalance';
import { useGroup } from '@/context/GroupContext';

interface Transaction {
  id: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'BUY' | 'SELL';
  amount: number;
  transacted_at: string;
  description: string | null;
  category_id: number | null;
  asset_id: string | null;
  categories: { name: string } | null;
  assets: { name: string } | null;
  users: { nickname: string; id: string } | null;
}

interface Category {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
  parent?: Category;
}

interface Asset {
  id: string;
  name: string;
  type: string;
}

interface EditForm {
  type: 'INCOME' | 'EXPENSE';
  transacted_at: string;
  description: string;
  category_id: string;
  asset_id: string;
  amount: string;
}

type SortCol = 'date' | 'description' | 'category' | 'asset' | 'amount';

const AMT_COLOR: Record<string, string> = {
  INCOME: 'text-green-600', EXPENSE: 'text-red-500',
  TRANSFER: 'text-blue-500', BUY: 'text-purple-500', SELL: 'text-orange-500',
};

const MIN_DATE = '2025-01-01';
const MAX_RANGE_DAYS = 365;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function TransactionList() {
  const { members } = useGroup();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 기간·멤버·유형·텍스트 필터
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => toYMD(new Date()));
  const [rangeError, setRangeError] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'INCOME' | 'EXPENSE'>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedMember, setSelectedMember] = useState<string>('all');

  // 그룹핑 모드
  const [groupMode, setGroupMode] = useState<'day' | 'month'>('day');

  // 컬럼 정렬 & 필터
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterCat, setFilterCat] = useState('');
  const [filterAsset, setFilterAsset] = useState('');
  const [openFilter, setOpenFilter] = useState<'category' | 'asset' | null>(null);
  const filterDropRef = useRef<HTMLDivElement>(null);

  // 인라인 편집
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const validateAndSetFrom = (val: string) => {
    setDateFrom(val);
    const from = new Date(val);
    const to = new Date(dateTo);
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (from > to) setRangeError('시작일이 종료일보다 늦을 수 없습니다.');
    else if (diffDays > MAX_RANGE_DAYS) setRangeError('최대 1년까지 조회 가능합니다.');
    else setRangeError('');
  };

  const validateAndSetTo = (val: string) => {
    setDateTo(val);
    const from = new Date(dateFrom);
    const to = new Date(val);
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (from > to) setRangeError('시작일이 종료일보다 늦을 수 없습니다.');
    else if (diffDays > MAX_RANGE_DAYS) setRangeError('최대 1년까지 조회 가능합니다.');
    else setRangeError('');
  };

  // 필터 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterDropRef.current && !filterDropRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 마스터 데이터 로드
  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('id, name, type, parent_id').order('type').order('parent_id', { nullsFirst: true }).order('id'),
      supabase.from('assets').select('id, name, type').eq('is_active', true).order('name'),
    ]).then(([catRes, assetRes]) => {
      if (catRes.data) setCategories(catRes.data as Category[]);
      if (assetRes.data) setAssets(assetRes.data as Asset[]);
    });
  }, []);

  const fetchTransactions = useCallback(async () => {
    if (rangeError) return;
    setLoading(true);
    const startD = new Date(dateFrom);
    const endD = new Date(dateTo);
    endD.setHours(23, 59, 59, 999);

    let query = supabase
      .from('transactions')
      .select('id, type, amount, transacted_at, description, category_id, asset_id, categories(name), assets!asset_id(name), users(nickname, id)')
      .eq('is_deleted', false)
      .gte('transacted_at', startD.toISOString())
      .lte('transacted_at', endD.toISOString())
      .order('transacted_at', { ascending: false });

    if (selectedMember !== 'all') query = query.eq('user_id', selectedMember);

    const { data, error } = await query.limit(1000);
    if (!error && data) setTransactions(data as unknown as Transaction[]);
    setLoading(false);
  }, [dateFrom, dateTo, selectedMember, rangeError]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    const channel = supabase.channel('tx-list-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchTransactions)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTransactions]);

  // 1차 필터 (기간·유형·텍스트)
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const matchDesc = tx.description?.toLowerCase().includes(q) ?? false;
        const matchCat = tx.categories?.name?.toLowerCase().includes(q) ?? false;
        if (!matchDesc && !matchCat) return false;
      }
      return true;
    });
  }, [transactions, typeFilter, searchText]);

  // 2차 필터 (컬럼 필터)
  const colFiltered = useMemo(() => {
    return filtered.filter((tx) => {
      if (filterCat && tx.categories?.name !== filterCat) return false;
      if (filterAsset && tx.assets?.name !== filterAsset) return false;
      return true;
    });
  }, [filtered, filterCat, filterAsset]);

  // 정렬 적용
  const sortedFlat = useMemo(() => {
    if (!sortCol) return colFiltered;
    return [...colFiltered].sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      if (sortCol === 'date')        { va = a.transacted_at;        vb = b.transacted_at; }
      if (sortCol === 'description') { va = (a.description ?? '').toLowerCase(); vb = (b.description ?? '').toLowerCase(); }
      if (sortCol === 'category')    { va = (a.categories?.name ?? '').toLowerCase(); vb = (b.categories?.name ?? '').toLowerCase(); }
      if (sortCol === 'asset')       { va = (a.assets?.name ?? '').toLowerCase(); vb = (b.assets?.name ?? '').toLowerCase(); }
      if (sortCol === 'amount')      { va = a.amount; vb = b.amount; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [colFiltered, sortCol, sortDir]);

  const toDateStr = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 날짜/월별 그룹
  const grouped = useMemo(() => {
    const map: Record<string, Transaction[]> = {};
    for (const tx of sortedFlat) {
      const key = groupMode === 'month'
        ? toDateStr(tx.transacted_at).slice(0, 7)   // YYYY-MM
        : toDateStr(tx.transacted_at);               // YYYY-MM-DD
      if (!map[key]) map[key] = [];
      map[key].push(tx);
    }
    return map;
  }, [sortedFlat, groupMode]);

  // 컬럼 필터용 유니크 값
  const uniqueCategories = useMemo(() =>
    [...new Set(filtered.map((tx) => tx.categories?.name).filter(Boolean) as string[])].sort(),
    [filtered]);
  const uniqueAssets = useMemo(() =>
    [...new Set(filtered.map((tx) => tx.assets?.name).filter(Boolean) as string[])].sort(),
    [filtered]);

  const totalExpense = colFiltered.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
  const totalIncome = colFiltered.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);

  // 카테고리 트리 (편집용)
  const categoryOptions = useMemo(() => {
    const parents = categories.filter((c) => !c.parent_id);
    const result: { id: number; label: string; type: string }[] = [];
    for (const p of parents) {
      const children = categories.filter((c) => c.parent_id === p.id);
      if (children.length === 0) result.push({ id: p.id, label: p.name, type: p.type });
      else for (const c of children) result.push({ id: c.id, label: `${p.name} > ${c.name}`, type: p.type });
    }
    return result;
  }, [categories]);

  const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
  const formatDateHeader = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return `${m}월 ${d}일 (${DAY_KR[day]})`;
  };

  const formatMonthHeader = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    return `${y}년 ${m}월`;
  };

  const startEdit = (tx: Transaction) => {
    if (tx.type !== 'INCOME' && tx.type !== 'EXPENSE') return;
    setEditingId(tx.id);
    setEditForm({
      type: tx.type,
      transacted_at: toDateStr(tx.transacted_at),
      description: tx.description ?? '',
      category_id: tx.category_id != null ? String(tx.category_id) : '',
      asset_id: tx.asset_id ?? '',
      amount: tx.amount.toLocaleString('ko-KR'),
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const saveEdit = async (id: number) => {
    if (!editForm) return;
    const numericAmount = parseInt(editForm.amount.replace(/,/g, ''), 10);
    if (isNaN(numericAmount) || numericAmount <= 0) { alert('유효한 금액을 입력하세요.'); return; }
    setSaving(true);

    // 수정 전 원본 자산/월 기록 (캐시 무효화용)
    const original = transactions.find(t => t.id === id);
    const oldAssetId = original?.asset_id ?? null;
    const oldYearMonth = original?.transacted_at?.slice(0, 7) ?? null;

    const { error } = await supabase.from('transactions').update({
      type: editForm.type,
      transacted_at: `${editForm.transacted_at}T00:00:00+09:00`,
      description: editForm.description || null,
      category_id: editForm.category_id ? Number(editForm.category_id) : null,
      asset_id: editForm.asset_id || null,
      amount: numericAmount,
    }).eq('id', id);
    setSaving(false);
    if (error) { alert('저장 실패: ' + error.message); return; }

    // 구 자산/월 및 신 자산/월 캐시 무효화
    const newYearMonth = editForm.transacted_at.slice(0, 7);
    const invalidations: Promise<void>[] = [];
    if (oldAssetId && oldYearMonth) invalidations.push(invalidateFrom(oldAssetId, oldYearMonth));
    if (editForm.asset_id && (editForm.asset_id !== oldAssetId || newYearMonth !== oldYearMonth)) {
      invalidations.push(invalidateFrom(editForm.asset_id, newYearMonth));
    }
    await Promise.all(invalidations);

    cancelEdit();
    fetchTransactions();
  };

  const deleteTransaction = async (id: number) => {
    if (!confirm('이 내역을 삭제하시겠습니까?')) return;
    const tx = transactions.find(t => t.id === id);
    setDeletingId(id);
    await supabase.from('transactions').update({ is_deleted: true }).eq('id', id);
    setDeletingId(null);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    if (tx?.asset_id && tx.transacted_at) {
      await invalidateFrom(tx.asset_id, tx.transacted_at.slice(0, 7));
    }
  };

  const handleAmountInput = (val: string) => {
    const raw = val.replace(/,/g, '');
    if (raw === '' || /^\d+$/.test(raw)) {
      setEditForm((f) => f ? { ...f, amount: raw === '' ? '' : Number(raw).toLocaleString('ko-KR') } : f);
    }
  };

  // 정렬 토글: none→asc→desc→none
  const handleSort = (col: SortCol) => {
    setOpenFilter(null);
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-500 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // 컬럼 헤더 행 렌더링 (그룹뷰·플랫뷰 공용)
  const renderHeaderRow = (showDateCol: boolean) => (
    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 font-semibold select-none">
      <th className="w-1 p-0" />
      {showDateCol && (
        <th
          className="w-[13%] px-2 py-2 text-left cursor-pointer hover:bg-gray-100"
          onClick={() => handleSort('date')}
        >
          날짜 <SortIcon col="date" />
        </th>
      )}
      <th
        className="px-2 py-2 text-left cursor-pointer hover:bg-gray-100"
        onClick={() => handleSort('description')}
      >
        적요 <SortIcon col="description" />
      </th>

      {/* 카테고리 — 정렬 + 필터 */}
      <th className="w-[22%] px-2 py-2 text-left relative">
        <div className="flex items-center gap-0.5" ref={openFilter === 'category' ? filterDropRef : undefined}>
          <button className="flex items-center hover:text-gray-700 truncate" onClick={() => handleSort('category')}>
            카테고리 <SortIcon col="category" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === 'category' ? null : 'category'); }}
            className={`shrink-0 rounded px-0.5 leading-none transition-colors ${filterCat ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500'}`}
            title="필터"
          >▾</button>
        </div>
        {openFilter === 'category' && (
          <div ref={filterDropRef} className="absolute left-0 top-full z-30 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 min-w-[150px] py-1 max-h-52 overflow-y-auto">
            <button
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${!filterCat ? 'text-blue-500 font-bold' : 'text-gray-700'}`}
              onClick={() => { setFilterCat(''); setOpenFilter(null); }}
            >전체</button>
            {uniqueCategories.map((cat) => (
              <button
                key={cat}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${filterCat === cat ? 'text-blue-500 font-bold' : 'text-gray-700'}`}
                onClick={() => { setFilterCat(cat); setOpenFilter(null); }}
              >{cat}</button>
            ))}
          </div>
        )}
      </th>

      {/* 결제수단 — 정렬 + 필터 */}
      <th className="w-[20%] px-2 py-2 text-left relative">
        <div className="flex items-center gap-0.5" ref={openFilter === 'asset' ? filterDropRef : undefined}>
          <button className="flex items-center hover:text-gray-700 truncate" onClick={() => handleSort('asset')}>
            결제수단 <SortIcon col="asset" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === 'asset' ? null : 'asset'); }}
            className={`shrink-0 rounded px-0.5 leading-none transition-colors ${filterAsset ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500'}`}
            title="필터"
          >▾</button>
        </div>
        {openFilter === 'asset' && (
          <div ref={filterDropRef} className="absolute left-0 top-full z-30 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 min-w-[150px] py-1 max-h-52 overflow-y-auto">
            <button
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${!filterAsset ? 'text-blue-500 font-bold' : 'text-gray-700'}`}
              onClick={() => { setFilterAsset(''); setOpenFilter(null); }}
            >전체</button>
            {uniqueAssets.map((a) => (
              <button
                key={a}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${filterAsset === a ? 'text-blue-500 font-bold' : 'text-gray-700'}`}
                onClick={() => { setFilterAsset(a); setOpenFilter(null); }}
              >{a}</button>
            ))}
          </div>
        )}
      </th>

      {members.length > 1 && <th className="w-14 px-2 py-2 text-left">작성자</th>}
      <th
        className="w-[20%] px-2 py-2 text-right cursor-pointer hover:bg-gray-100"
        onClick={() => handleSort('amount')}
      >
        금액 <SortIcon col="amount" />
      </th>
      <th className="w-11 px-2 py-2 text-center">관리</th>
    </tr>
  );

  // 일반 행 렌더링
  const renderRow = (tx: Transaction, showDate = false) => {
    if (editingId === tx.id && editForm) {
      const colSpan = (showDate ? 1 : 0) + (members.length > 1 ? 6 : 5);
      return (
        <tr key={tx.id} className="bg-blue-50">
          <td className="w-1 p-0 bg-blue-300" />
          <td colSpan={colSpan} className="px-3 py-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">날짜</label>
                <input type="date" value={editForm.transacted_at}
                  onChange={(e) => setEditForm((f) => f ? { ...f, transacted_at: e.target.value } : f)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">구분</label>
                <select value={editForm.type}
                  onChange={(e) => setEditForm((f) => f ? { ...f, type: e.target.value as 'INCOME' | 'EXPENSE', category_id: '' } : f)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800">
                  <option value="EXPENSE">지출</option>
                  <option value="INCOME">수입</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">금액</label>
                <input type="text" inputMode="numeric" value={editForm.amount}
                  onChange={(e) => handleAmountInput(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs text-gray-500 mb-1 block">적요</label>
                <input type="text" value={editForm.description}
                  onChange={(e) => setEditForm((f) => f ? { ...f, description: e.target.value } : f)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">카테고리</label>
                <select value={editForm.category_id}
                  onChange={(e) => setEditForm((f) => f ? { ...f, category_id: e.target.value } : f)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800">
                  <option value="">선택 안함</option>
                  {categoryOptions.filter((c) => c.type === editForm.type)
                    .map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">결제수단</label>
                <select value={editForm.asset_id}
                  onChange={(e) => setEditForm((f) => f ? { ...f, asset_id: e.target.value } : f)}
                  className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800">
                  <option value="">선택 안함</option>
                  {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={cancelEdit}
                className="px-4 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={() => saveEdit(tx.id)} disabled={saving}
                className="px-4 py-1.5 text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 rounded-lg font-semibold">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
        <td className={`w-1 p-0 ${tx.type === 'EXPENSE' ? 'bg-red-400' : tx.type === 'INCOME' ? 'bg-green-400' : 'bg-blue-300'}`} />
        {showDate && (
          <td className="px-2 py-2.5 text-xs text-gray-400 truncate">
            {toDateStr(tx.transacted_at).slice(5).replace('-', '/')}
          </td>
        )}
        <td className="px-2 py-2.5 text-xs text-gray-700 truncate">{tx.description ?? '-'}</td>
        <td className="px-2 py-2.5 text-xs text-gray-600 truncate">{tx.categories?.name ?? '-'}</td>
        <td className="px-2 py-2.5 text-xs text-gray-500 truncate">{tx.assets?.name ?? '-'}</td>
        {members.length > 1 && <td className="px-2 py-2.5 text-xs text-gray-500 truncate">{tx.users?.nickname ?? '-'}</td>}
        <td className={`px-2 py-2.5 text-xs font-bold text-right truncate ${AMT_COLOR[tx.type]}`}>
          {tx.type === 'INCOME' ? '+' : tx.type === 'EXPENSE' ? '-' : ''}{tx.amount.toLocaleString('ko-KR')}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-center gap-1">
            {(tx.type === 'INCOME' || tx.type === 'EXPENSE') && (
              <button onClick={() => startEdit(tx)}
                className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors" title="수정">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
            )}
            <button onClick={() => deleteTransaction(tx.id)} disabled={deletingId === tx.id}
              className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors disabled:opacity-40" title="삭제">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const hasColFilter = !!(filterCat || filterAsset);

  // 날짜 그룹 키 순서: date 정렬 시 방향 반영, 그 외 항상 최신순
  const groupedKeys = useMemo(() => {
    const keys = Object.keys(grouped);
    if (sortCol === 'date') {
      return keys.sort((a, b) => sortDir === 'asc' ? (a < b ? -1 : 1) : (a > b ? -1 : 1));
    }
    return keys.sort((a, b) => (a > b ? -1 : 1));
  }, [grouped, sortCol, sortDir]);

  return (
    <div className="space-y-3">
      {/* 필터 영역 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 space-y-2">
        {/* 기간 선택 */}
        <div>
          <p className="text-[11px] text-gray-400 mb-1.5">조회 기간 <span className="text-gray-300">(최대 1년)</span></p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              min={MIN_DATE}
              max={dateTo}
              onChange={(e) => validateAndSetFrom(e.target.value)}
              className="flex-1 px-2 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
            />
            <span className="text-xs text-gray-400 shrink-0">~</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={toYMD(new Date())}
              onChange={(e) => validateAndSetTo(e.target.value)}
              className="flex-1 px-2 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
            />
          </div>
          {rangeError && (
            <p className="text-[11px] text-red-500 mt-1">{rangeError}</p>
          )}
        </div>

        {members.length > 1 && (
          <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800">
            <option value="all">전체 멤버</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
          </select>
        )}

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['all', 'EXPENSE', 'INCOME'] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${typeFilter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>
              {t === 'all' ? '전체' : t === 'EXPENSE' ? '지출' : '수입'}
            </button>
          ))}
        </div>

        <select
          value={filterAsset}
          onChange={(e) => setFilterAsset(e.target.value)}
          className={`w-full px-3 py-2 bg-gray-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${filterAsset ? 'text-blue-600 font-medium' : 'text-gray-500'}`}
        >
          <option value="">전체 결제수단</option>
          {assets.map((a) => (
            <option key={a.id} value={a.name}>{a.name}</option>
          ))}
        </select>

        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)}
          placeholder="적요 또는 카테고리 검색"
          className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800" />
      </div>

      {/* 활성 컬럼 필터 배지 */}
      {hasColFilter && (
        <div className="flex flex-wrap gap-1.5">
          {filterCat && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
              카테고리: {filterCat}
              <button onClick={() => setFilterCat('')} className="hover:text-blue-800 font-bold leading-none">×</button>
            </span>
          )}
          {filterAsset && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
              결제수단: {filterAsset}
              <button onClick={() => setFilterAsset('')} className="hover:text-blue-800 font-bold leading-none">×</button>
            </span>
          )}
        </div>
      )}

      {/* 요약 + 그룹 토글 */}
      <div className="flex items-stretch gap-2">
        <div className="flex-1 bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-0.5">기간 지출</p>
          <p className="text-base font-bold text-red-500">-{totalExpense.toLocaleString('ko-KR')}원</p>
        </div>
        <div className="flex-1 bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-0.5">기간 수입</p>
          <p className="text-base font-bold text-green-600">+{totalIncome.toLocaleString('ko-KR')}원</p>
        </div>
        <div className="flex flex-col gap-1 bg-white rounded-xl border border-gray-100 px-2 py-2 justify-center">
          {(['day', 'month'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setGroupMode(mode)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${groupMode === mode ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}
            >
              {mode === 'day' ? '일별' : '월별'}
            </button>
          ))}
        </div>
      </div>

      {/* 내역 */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">불러오는 중...</div>
      ) : colFiltered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">조건에 맞는 거래 내역이 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {groupedKeys.map((groupKey) => {
            const txs = grouped[groupKey];
            const groupNet = txs.reduce((s, t) => {
              if (t.type === 'INCOME') return s + t.amount;
              if (t.type === 'EXPENSE') return s - t.amount;
              return s;
            }, 0);
            const isMonth = groupMode === 'month';
            return (
              <div key={groupKey}>
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <span className="text-sm font-semibold text-gray-600">
                    {isMonth ? formatMonthHeader(groupKey) : formatDateHeader(groupKey)}
                  </span>
                  <span className={`text-sm font-semibold ${groupNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {groupNet >= 0 ? '+' : ''}{groupNet.toLocaleString('ko-KR')}원
                  </span>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <table className="w-full table-fixed">
                    <thead>{renderHeaderRow(isMonth)}</thead>
                    <tbody className="divide-y divide-gray-50">
                      {txs.map((tx) => renderRow(tx, isMonth))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          <div className="text-xs text-gray-400 text-right px-1">{colFiltered.length}건</div>
        </div>
      )}
    </div>
  );
}
