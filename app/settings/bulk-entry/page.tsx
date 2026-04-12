'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import { resizeImage } from '@/utils/imageResize';
import toast from 'react-hot-toast';

interface Asset    { id: string; name: string; type: string; }
interface Category { id: number; name: string; type: string; parent_id: number | null; is_system?: boolean; }

interface Row {
  _id: number;
  transactedAt: string;
  type: 'EXPENSE' | 'INCOME';
  description: string;
  amount: string;
  assetId: string;
  categoryId: string;
  invalidAsset?: string;
  invalidCategory?: string;
  fuzzyAsset?: string;    // 유사도 매칭 시 원본 엑셀 값
  fuzzyCategory?: string; // 유사도 매칭 시 원본 엑셀 값
}

const today = new Date().toISOString().split('T')[0];
let _seq = 0;

// 두 문자열의 유사도를 0~1로 반환 (1이 완전 일치)
const strSimilarity = (a: string, b: string): number => {
  const s1 = a.toLowerCase().replace(/[\s>›]/g, '');
  const s2 = b.toLowerCase().replace(/[\s>›]/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  const m = s1.length, n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
};
const makeRow = (defaults: Partial<Row> = {}): Row => ({
  _id: ++_seq,
  transactedAt: today,
  type: 'EXPENSE',
  description: '',
  amount: '',
  assetId: '',
  categoryId: '',
  ...defaults,
});

const DEFAULT_ROWS = 8;

export default function BulkEntryPage() {
  const { group, currentUser } = useGroup();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: DEFAULT_ROWS }, () => makeRow()));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: number; fail: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // 자산 선택 모달
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'excel' | 'image' | null>(null);
  const [pickedAssetId, setPickedAssetId] = useState<string>('');

  const tableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('assets').select('id, name, type').eq('is_active', true).order('name'),
      supabase.from('categories').select('id, name, type, parent_id, is_system').eq('is_visible', true).order('name'),
    ]).then(([a, c]) => {
      if (a.data) setAssets(a.data as Asset[]);
      if (c.data) setCategories(c.data as Category[]);
    });
  }, []);

  // 카테고리를 "대분류 > 소분류" 형태의 flat list로 변환
  const categoryOptions = (type: 'EXPENSE' | 'INCOME') => {
    const filtered = categories.filter((c) => c.type === type);
    const roots = filtered.filter((c) => !c.parent_id);
    const result: { id: string; label: string }[] = [];
    roots.forEach((root) => {
      if (root.is_system) {
        if (root.name === '카드정산') {
          const cards = assets.filter(a => a.type === 'CARD');
          cards.forEach(card => result.push({ id: `system_${root.id}_${card.id}`, label: `${root.name} › ${card.name}` }));
        } else {
          const transferAssets = assets.filter(a => a.type !== 'CARD');
          transferAssets.forEach(asset => result.push({ id: `system_${root.id}_${asset.id}`, label: `${root.name} › ${asset.name}` }));
        }
      } else {
        const subs = filtered.filter((c) => c.parent_id === root.id);
        if (subs.length === 0) {
          result.push({ id: String(root.id), label: root.name });
        } else {
          subs.forEach((sub) => result.push({ id: String(sub.id), label: `${root.name} › ${sub.name}` }));
        }
      }
    });
    return result;
  };

  const updateRow = (id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, ...patch } : r));
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r._id !== id));
  };

  const addRows = (n = 5) => {
    setRows((prev) => [...prev, ...Array.from({ length: n }, () => makeRow())]);
  };

  const handleTypeChange = (id: number, type: 'EXPENSE' | 'INCOME') => {
    updateRow(id, { type, categoryId: '', invalidCategory: undefined });
  };

  // 동일한 오류 텍스트를 가진 다른 행들도 일괄 업데이트하는 핸들러 (자산/계좌)
  const handleAssetChange = (id: number, newAssetId: string, invalidAssetVal?: string) => {
    setRows((prev) => prev.map((r) => {
      if (r._id === id) {
        return { ...r, assetId: newAssetId, invalidAsset: undefined, fuzzyAsset: undefined };
      }
      if (invalidAssetVal && r.invalidAsset === invalidAssetVal && newAssetId !== '') {
        return { ...r, assetId: newAssetId, invalidAsset: undefined, fuzzyAsset: undefined };
      }
      return r;
    }));
  };

  // 동일한 오류 텍스트를 가진 다른 행들도 일괄 업데이트하는 핸들러 (카테고리)
  const handleCategoryChange = (id: number, newCategoryId: string, invalidCategoryVal?: string) => {
    setRows((prev) => prev.map((r) => {
      if (r._id === id) {
        return { ...r, categoryId: newCategoryId, invalidCategory: undefined, fuzzyCategory: undefined };
      }
      if (invalidCategoryVal && r.invalidCategory === invalidCategoryVal && newCategoryId !== '') {
        return { ...r, categoryId: newCategoryId, invalidCategory: undefined, fuzzyCategory: undefined };
      }
      return r;
    }));
  };

  // Tab 키로 마지막 행에서 새 행 추가
  const handleLastCellTab = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      addRows(1);
      setTimeout(() => {
        const inputs = tableRef.current?.querySelectorAll('input, select');
        if (inputs) (inputs[inputs.length - 7] as HTMLElement)?.focus();
      }, 50);
    }
  };

  const filledRows = rows.filter((r) => r.amount.trim() !== '');

  const handleSave = async () => {
    if (filledRows.length === 0) return;

    const hasErrors = filledRows.some((r) => r.invalidAsset || r.invalidCategory);
    if (hasErrors) {
      alert('유효하지 않은 자산이나 카테고리가 포함된 행이 있습니다. 오류를 수정한 후 다시 시도해 주세요.');
      return;
    }

    setSaving(true);
    setResult(null);
    let success = 0, fail = 0;

    for (const row of filledRows) {
      const amount = Number(row.amount.replace(/,/g, ''));
      if (!amount || isNaN(amount)) { fail++; continue; }

      let categoryId: number | null = null;
      let isSystem = false;
      let targetAssetId: string | null = null;

      if (row.categoryId && row.categoryId.startsWith('system_')) {
        const parts = row.categoryId.split('_');
        isSystem = true;
        categoryId = Number(parts[1]);
        targetAssetId = parts[2];
      } else {
        categoryId = row.categoryId ? Number(row.categoryId) : null;
      }

      const base = {
        category_id: categoryId,
        user_id: currentUser?.id || null,
        transacted_at: row.transactedAt,
        description: row.description || null,
        amount,
        group_id: group?.id || null,
        is_deleted: false,
      };

      if (isSystem && targetAssetId && row.assetId) {
        const pairId = crypto.randomUUID();
        const expenseAssetId = row.type === 'EXPENSE' ? row.assetId : targetAssetId;
        const incomeAssetId = row.type === 'EXPENSE' ? targetAssetId : row.assetId;
        const { error } = await supabase.from('transactions').insert([
          { ...base, type: 'EXPENSE', asset_id: expenseAssetId, transfer_pair_id: pairId },
          { ...base, type: 'INCOME',  asset_id: incomeAssetId, transfer_pair_id: pairId },
        ]);
        if (error) fail++; else success++;
      } else {
        const { error } = await supabase.from('transactions').insert({ ...base, type: row.type, asset_id: row.assetId || null });
        if (error) fail++; else success++;
      }
    }

    setSaving(false);
    setResult({ success, fail });
    if (success > 0) {
      setRows((prev) => prev.map((r) => r.amount.trim() !== '' ? makeRow() : r));
      if (fail === 0) {
        toast.success(`${success}건 일괄 저장이 완료되었습니다.`);
      } else {
        toast.error(`${success}건 저장 완료 · ${fail}건 실패`);
      }
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([
        ['거래일(YYYY-MM-DD)', '유형(수입/지출)', '적요', '금액', '자산명', '카테고리명'],
        [today, '지출', '예시) 점심 식사', '15000', assets[0]?.name || '', categoryOptions('EXPENSE')[0]?.label || ''],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '일괄입력');
      XLSX.writeFile(wb, '거래내역_일괄입력_템플릿.xlsx');
    } catch (e) {
      alert('엑셀 파일을 생성하는 중 오류가 발생했습니다. (xlsx 패키지 설치 필요)');
    }
  };

  // 버튼 클릭 → 자산 선택 모달 열기
  const openAssetPicker = (action: 'excel' | 'image') => {
    setPickedAssetId('');
    setPendingAction(action);
    setAssetPickerOpen(true);
  };

  // 모달 취소
  const handleAssetPickerCancel = () => {
    setAssetPickerOpen(false);
    setPendingAction(null);
  };

  // 모달 확인 → 실제 파일 선택 트리거
  const handleAssetPickerConfirm = () => {
    setAssetPickerOpen(false);
    if (pendingAction === 'excel') {
      fileInputRef.current?.click();
    }
    setPendingAction(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      reader.onload = (evt) => {
        const data = evt.target?.result;
        // cellDates 옵션 제거 → 날짜 셀을 raw 시리얼 숫자로 받아 timezone 없이 직접 파싱
        const wb = XLSX.read(data, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rowsData = XLSX.utils.sheet_to_json<any>(ws, { raw: true });

        const parseExcelDate = (val: unknown): string => {
          if (typeof val === 'number') {
            // 시리얼 숫자 → timezone 변환 없이 날짜만 추출
            const date = XLSX.SSF.parse_date_code(val);
            const y = date.y;
            const m = String(date.m).padStart(2, '0');
            const d = String(date.d).padStart(2, '0');
            return `${y}-${m}-${d}`;
          }
          if (typeof val === 'string' && val.trim()) return val.trim();
          return today;
        };

        const SIMILARITY_THRESHOLD = 0.45;
        const normalize = (str: string) => str.replace(/\s+/g, '').replace(/>/g, '›');

        const newRows: Row[] = rowsData.map((r: any) => {
          const typeStr = r['유형(수입/지출)'] || '지출';
          const type = typeStr.includes('수입') ? 'INCOME' : 'EXPENSE';
          // 자산: 선택된 자산 우선, 없으면 정확 매칭 → 유사도 매칭 순
          const excelAssetName = r['자산명'];
          let matchedAsset = pickedAssetId
            ? assets.find((a) => a.id === pickedAssetId)
            : assets.find((a) => a.name === excelAssetName);
          let fuzzyAssetOriginal: string | undefined;
          if (!matchedAsset && excelAssetName && !pickedAssetId) {
            const best = assets.reduce<{ asset: Asset | null; score: number }>(
              (b, a) => { const s = strSimilarity(a.name, String(excelAssetName)); return s > b.score ? { asset: a, score: s } : b; },
              { asset: null, score: 0 }
            );
            if (best.score >= SIMILARITY_THRESHOLD) {
              matchedAsset = best.asset!;
              fuzzyAssetOriginal = String(excelAssetName);
            }
          }
          // 카테고리: 정확 매칭 → 유사도 매칭 순
          const rawCatName = r['카테고리명'] || '';
          const catNameNormalized = normalize(rawCatName);
          const catOpts = categoryOptions(type);
          let matchedCat = catOpts.find((c) => normalize(c.label) === catNameNormalized);
          let fuzzyCategoryOriginal: string | undefined;
          if (!matchedCat && rawCatName) {
            const best = catOpts.reduce<{ cat: { id: string; label: string } | null; score: number }>(
              (b, c) => { const s = strSimilarity(c.label, rawCatName); return s > b.score ? { cat: c, score: s } : b; },
              { cat: null, score: 0 }
            );
            if (best.score >= SIMILARITY_THRESHOLD) {
              matchedCat = best.cat!;
              fuzzyCategoryOriginal = rawCatName;
            }
          }

          return makeRow({
            transactedAt: parseExcelDate(r['거래일(YYYY-MM-DD)']),
            type,
            description: r['적요'] || '',
            amount: r['금액'] ? String(r['금액']).replace(/[^0-9]/g, '') : '',
            assetId: matchedAsset ? matchedAsset.id : '',
            categoryId: matchedCat ? matchedCat.id : '',
            invalidAsset: !matchedAsset && excelAssetName && !pickedAssetId ? String(excelAssetName) : undefined,
            invalidCategory: !matchedCat && rawCatName ? String(rawCatName) : undefined,
            fuzzyAsset: fuzzyAssetOriginal,
            fuzzyCategory: fuzzyCategoryOriginal,
          });
        });

        if (newRows.length > 0) setRows(newRows);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsBinaryString(file);
    } catch (e) {
      alert('엑셀 파일을 처리하는 중 오류가 발생했습니다. (xlsx 패키지 설치 확인)');
    }
  };

  const handleImageAnalyze = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);

    let fileToUpload = file;
    // 1MB를 초과하는 경우 클라이언트 측에서 이미지 리사이징 진행
    if (file.size > 1024 * 1024) {
      try {
        fileToUpload = await resizeImage(file, 1600, 1600, 0.8);
      } catch (err) {
        console.error('이미지 리사이징 중 오류 발생:', err);
      }
    }

    try {
      const allCatOptions = [
        ...categoryOptions('EXPENSE').map((c) => ({ ...c, type: 'EXPENSE' })),
        ...categoryOptions('INCOME').map((c) => ({ ...c, type: 'INCOME' })),
      ];

      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('categories', JSON.stringify(allCatOptions));

      const res = await fetch('/api/analyze-transactions', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.error) {
        alert(`이미지 분석 실패: ${data.error}`);
        return;
      }

      const newRows: Row[] = (data.transactions ?? []).map((t: any) => makeRow({
        transactedAt: t.transactedAt || today,
        type: t.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        description: t.description || '',
        amount: t.amount != null ? Number(t.amount).toLocaleString('ko-KR') : '',
        assetId: pickedAssetId || '',
        categoryId: t.categoryId != null ? String(t.categoryId) : '',
      }));

      if (newRows.length > 0) {
        setRows(newRows);
      } else {
        alert('거래 내역을 찾을 수 없습니다. 이미지를 확인해 주세요.');
      }
    } catch (err) {
      alert('이미지 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const pickedAsset = assets.find((a) => a.id === pickedAssetId);

  // PC 전용 안내
  const MobileBlock = () => (
    <div className="md:hidden flex flex-col items-center justify-center py-20 px-8 text-center gap-3">
      <span className="text-4xl">🖥️</span>
      <p className="text-gray-600 font-semibold">PC 환경에서만 사용 가능합니다</p>
      <p className="text-sm text-gray-400">일괄 입력 기능은 넓은 화면이 필요합니다.</p>
    </div>
  );

  return (
    <>
      <MobileBlock />
      <main className="hidden md:block px-6 py-4 pb-8">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">
            금액을 입력한 행만 저장됩니다. Tab 키로 마지막 행에서 새 행을 추가할 수 있습니다.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              템플릿 다운로드
            </button>
            <button
              onClick={() => openAssetPicker('excel')}
              className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              엑셀 업로드
            </button>
            <button
              onClick={() => openAssetPicker('image')}
              disabled={analyzing}
              className="text-xs px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 transition-colors"
            >
              {analyzing ? '분석 중...' : '이미지 분석'}
            </button>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <input
              type="file"
              accept="image/*" capture="environment"
              className="hidden"
              ref={cameraInputRef}
              onChange={handleImageAnalyze}
            />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={galleryInputRef}
              onChange={handleImageAnalyze}
            />
          </div>
        </div>

        {/* 이미지 분석 중 안내 */}
        {analyzing && (
          <div className="mb-3 px-4 py-3 rounded-xl text-sm font-medium bg-purple-50 text-purple-700 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            이미지에서 거래 내역을 분석하고 있습니다...
          </div>
        )}

        {/* 결과 메시지 */}
        {result && (
          <div className={`mb-3 px-4 py-3 rounded-xl text-sm font-medium ${result.fail === 0 ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
            {result.success}건 저장 완료
            {result.fail > 0 && ` · ${result.fail}건 실패`}
          </div>
        )}

        {/* 테이블 */}
        <div ref={tableRef} className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-3 py-2.5 text-left border-b border-gray-200 w-32">거래일</th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 w-20">유형</th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200">적요</th>
                <th className="px-3 py-2.5 text-right border-b border-gray-200 w-32">금액 (원)</th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 w-36">자산/계좌</th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 w-44">카테고리</th>
                <th className="px-2 py-2.5 border-b border-gray-200 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const catOptions = categoryOptions(row.type);
                const isLast = idx === rows.length - 1;
                const cellCls = 'px-1 py-1 border-b border-gray-100';
                const inputCls = 'w-full px-2 py-1.5 rounded-lg border border-transparent bg-transparent hover:bg-gray-50 focus:bg-white focus:border-blue-400 focus:outline-none text-gray-800 text-sm transition-colors';
                const selectCls = inputCls + ' cursor-pointer';

                return (
                  <tr key={row._id} className={row.amount ? 'bg-blue-50/30' : 'hover:bg-gray-50/50'}>
                    {/* 거래일 */}
                    <td className={cellCls}>
                      <input
                        type="date"
                        value={row.transactedAt}
                        onChange={(e) => updateRow(row._id, { transactedAt: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    {/* 유형 */}
                    <td className={cellCls}>
                      <select
                        value={row.type}
                        onChange={(e) => handleTypeChange(row._id, e.target.value as 'EXPENSE' | 'INCOME')}
                        className={`${selectCls} ${row.type === 'EXPENSE' ? 'text-red-500' : 'text-blue-600'}`}
                      >
                        <option value="EXPENSE">지출</option>
                        <option value="INCOME">수입</option>
                      </select>
                    </td>
                    {/* 적요 */}
                    <td className={cellCls}>
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => updateRow(row._id, { description: e.target.value })}
                        placeholder="거래 내용"
                        className={inputCls}
                      />
                    </td>
                    {/* 금액 */}
                    <td className={cellCls}>
                      <input
                        type="text"
                        value={row.amount}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          updateRow(row._id, { amount: v ? Number(v).toLocaleString('ko-KR') : '' });
                        }}
                        placeholder="0"
                        className={`${inputCls} text-right`}
                        onKeyDown={isLast ? handleLastCellTab : undefined}
                      />
                    </td>
                    {/* 자산 */}
                    <td className={cellCls}>
                      <select
                        value={row.assetId}
                        onChange={(e) => handleAssetChange(row._id, e.target.value, row.invalidAsset)}
                        title={row.fuzzyAsset ? `엑셀 원본값: ${row.fuzzyAsset}` : undefined}
                        className={`${selectCls} ${row.invalidAsset ? '!border-red-400 !bg-red-50 !text-red-600' : row.fuzzyAsset ? '!border-amber-400 !bg-amber-50' : ''}`}
                      >
                        <option value="">{row.invalidAsset ? `(오류) ${row.invalidAsset}` : '-'}</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {row.fuzzyAsset && (
                        <p className="text-[10px] text-amber-600 px-1 mt-0.5 truncate" title={row.fuzzyAsset}>
                          원본: {row.fuzzyAsset}
                        </p>
                      )}
                    </td>
                    {/* 카테고리 */}
                    <td className={cellCls}>
                      <select
                        value={row.categoryId}
                        onChange={(e) => handleCategoryChange(row._id, e.target.value, row.invalidCategory)}
                        title={row.fuzzyCategory ? `엑셀 원본값: ${row.fuzzyCategory}` : undefined}
                        className={`${selectCls} ${row.invalidCategory ? '!border-red-400 !bg-red-50 !text-red-600' : row.fuzzyCategory ? '!border-amber-400 !bg-amber-50' : ''}`}
                      >
                        <option value="">{row.invalidCategory ? `(오류) ${row.invalidCategory}` : '-'}</option>
                        {catOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      {row.fuzzyCategory && (
                        <p className="text-[10px] text-amber-600 px-1 mt-0.5 truncate" title={row.fuzzyCategory}>
                          원본: {row.fuzzyCategory}
                        </p>
                      )}
                    </td>
                    {/* 삭제 */}
                    <td className={`${cellCls} text-center`}>
                      <button
                        type="button"
                        onClick={() => removeRow(row._id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none px-1"
                        tabIndex={-1}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 하단 버튼 */}
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={() => addRows(5)}
            className="text-sm text-gray-500 hover:text-blue-500 border border-gray-300 hover:border-blue-400 px-4 py-2 rounded-xl transition-colors"
          >
            + 5행 추가
          </button>
          <div className="flex items-center gap-3">
            {filledRows.length > 0 && (
              <span className="text-xs text-gray-400">{filledRows.length}건 저장 대기</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || filledRows.length === 0}
              className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-sm shadow-blue-200"
            >
              {saving ? '저장 중...' : `${filledRows.length}건 일괄 저장`}
            </button>
          </div>
        </div>
      </main>

      {/* 자산/계좌 선택 모달 */}
      {assetPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={handleAssetPickerCancel} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-bold text-gray-800 mb-1">자산/계좌 선택</h3>
            <p className="text-xs text-gray-400 mb-4">
              {pendingAction === 'excel' ? '업로드할 엑셀 파일의' : '분석할 이미지의'} 거래가 속한 자산/계좌를 선택해 주세요.
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto mb-5">
              {/* 선택 안 함 */}
              <label className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${pickedAssetId === '' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input
                  type="radio"
                  name="assetPick"
                  value=""
                  checked={pickedAssetId === ''}
                  onChange={() => setPickedAssetId('')}
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-400">선택 안 함</span>
              </label>

              {assets.map((a) => (
                <label
                  key={a.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${pickedAssetId === a.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  <input
                    type="radio"
                    name="assetPick"
                    value={a.id}
                    checked={pickedAssetId === a.id}
                    onChange={() => setPickedAssetId(a.id)}
                    className="accent-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-800">{a.name}</span>
                  <span className="ml-auto text-xs text-gray-400">{a.type === 'CARD' ? '카드' : a.type === 'BANK' ? '은행' : a.type}</span>
                </label>
              ))}
            </div>

            {pendingAction === 'excel' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAssetPickerCancel}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleAssetPickerConfirm}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  {pickedAsset ? `${pickedAsset.name} 선택` : '선택 없이 계속'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAssetPickerOpen(false);
                    cameraInputRef.current?.click();
                    setPendingAction(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-purple-50 text-purple-600 font-bold hover:bg-purple-100 transition-colors flex items-center justify-center gap-2"
                >
                  <span>📷</span> 카메라로 촬영
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAssetPickerOpen(false);
                    galleryInputRef.current?.click();
                    setPendingAction(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-gray-50 text-gray-700 font-bold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                >
                  <span>🖼️</span> 갤러리에서 선택
                </button>
                <button
                  type="button"
                  onClick={handleAssetPickerCancel}
                  className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors mt-1"
                >
                  취소
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
