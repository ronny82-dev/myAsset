'use client';
import React, { useState, useEffect, useRef } from 'react';
import { calculateExpectedBillingDate } from '@/utils/dateCalc';
import { resizeImage } from '@/utils/imageResize';

export interface Asset {
  id: string;
  name: string;
  type: string;
  balance?: number;
  card_details?: { settlement_day: number; billing_start_offset?: number; billing_end_offset?: number };
}

export interface Category {
  id: number | string;
  name: string;
  type?: string;
  parent_id?: number | string | null;
  is_system?: boolean;
}

export interface Member {
  id: string;
  nickname: string;
}

type TransactionType = 'EXPENSE' | 'INCOME';

interface Suggestion {
  categoryId: string | number | null;
  categoryName: string;
  parentId: string | number | null;
  parentName: string;
  isNew: boolean;
}

interface ExpenseFormProps {
  assets: Asset[];
  categories: Category[];
  members?: Member[];
  onSubmit: (data: {
    type: TransactionType;
    amount: string;
    selectedAsset?: Asset;
    selectedCategory?: Category;
    billingDate?: Date | null;
    transactedAt: string;
    description?: string;
    transferTargetAsset?: Asset;
  }) => void;
  onCategoryCreate: (name: string, type: TransactionType, parentId?: string | number | null) => Promise<Category | null>;
}

const ExpenseForm = ({ assets, categories, onSubmit, onCategoryCreate }: ExpenseFormProps) => {
  const [transactionType, setTransactionType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState<string>('');
  const [transactedAt, setTransactedAt] = useState<string>(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState<string>('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>(assets?.[0]);
  const [selectedCategory, setSelectedCategory] = useState<Category | undefined>();
  const [billingDate, setBillingDate] = useState<Date | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [applyingNew, setApplyingNew] = useState(false);
  const [activeRootId, setActiveRootId] = useState<number | string | undefined>();
  const [imageUploading, setImageUploading] = useState(false);
  const [multipleDatesWarning, setMultipleDatesWarning] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'CARD' | 'CASH'>('CARD');
  const [transferTargetAsset, setTransferTargetAsset] = useState<Asset | undefined>();
  const [imageSourcePickerOpen, setImageSourcePickerOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);


  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const transactionTypeRef = useRef(transactionType);
  transactionTypeRef.current = transactionType;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredCategories = categories.filter((c) => c.type === transactionType);

  // 타입 변경 시 카테고리 초기화 + 대기 중인 debounce 취소
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const roots = categories.filter((c) => c.type === transactionType && !c.parent_id);
    setSelectedCategory(roots[0]);
    setActiveRootId(roots[0]?.id);
    setSuggestion(null);
    setSuggestLoading(false);
    setTransferTargetAsset(undefined);
    // 지출→수입 전환 시 전체 자산 기준으로 초기화
    if (transactionType === 'INCOME') setSelectedAsset(assets[0]);
    else setSelectedAsset(assets.filter((a) => a.type === 'CARD')[0] ?? assets[0]);
  }, [transactionType]);

  // 초기 카테고리 설정
  useEffect(() => {
    const roots = categories.filter((c) => c.type === transactionType && !c.parent_id);
    if (!selectedCategory) setSelectedCategory(roots[0]);
    if (!activeRootId) setActiveRootId(roots[0]?.id);
  }, [categories]);

  // 자산 변경 시 결제 예정일 계산
  useEffect(() => {
    if (transactionType === 'EXPENSE' && selectedAsset?.type === 'CARD' && selectedAsset.card_details) {
      const { settlement_day, billing_start_offset, billing_end_offset } = selectedAsset.card_details;
      setBillingDate(calculateExpectedBillingDate(new Date(), settlement_day, billing_start_offset, billing_end_offset));
    } else {
      setBillingDate(null);
    }
  }, [selectedAsset, transactionType]);

  // AI 카테고리 제안 실행 함수 (debounce·blur 공용)
  const runCategorySuggest = async (desc: string) => {
    const type = transactionTypeRef.current;
    if (desc.trim().length < 3) return;
    // 앱 전체에 대분류가 하나도 없으면 제안 불가
    if (categoriesRef.current.filter((c) => !c.parent_id).length === 0) return;
    setSuggestLoading(true);
    setSuggestion(null);
    try {
      // 해당 유형의 카테고리가 없으면 전체 카테고리에서 대분류를 가져와 제안 기준으로 사용
      const filtered = categoriesRef.current.filter((c) => c.type === type);
      const roots = filtered.filter((c) => !c.parent_id);
      const baseRoots = roots.length > 0 ? roots : categoriesRef.current.filter((c) => !c.parent_id);
      const baseCats  = roots.length > 0 ? filtered : categoriesRef.current;
      const tree = baseRoots.map((root) => ({
        id: root.id,
        name: root.name,
        subCategories: baseCats.filter((c) => c.parent_id === root.id).map((c) => ({ id: c.id, name: c.name })),
      }));
      const res = await fetch('/api/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, transactionType: type, categories: tree }),
      });
      const data = await res.json();
      if (data.categoryName) setSuggestion(data);
      else setSuggestion(null);
    } catch {
      setSuggestion(null);
    } finally {
      setSuggestLoading(false);
    }
  };

  // 적요 onChange: debounce 타이머 갱신
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDescription(value);
    setSuggestion(null);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (value.trim().length >= 3) {
      debounceTimerRef.current = setTimeout(() => runCategorySuggest(value), 1000);
    }
  };

  // 적요 onBlur: 대기 중인 타이머를 취소하고 즉시 실행
  const handleDescriptionBlur = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (description.trim().length >= 3 && !suggestLoading && !suggestion) {
      runCategorySuggest(description);
    }
  };

  const applySuggestion = async () => {
    if (!suggestion) return;
    setApplyingNew(true);
    try {
      let parentId = suggestion.parentId;

      // 기존 대분류를 이름으로 탐색 (id 불일치 대비)
      if (!parentId && suggestion.parentName) {
        const existingParent = categoriesRef.current.find(
          (c) => c.name === suggestion.parentName && !c.parent_id
        );
        if (existingParent) parentId = existingParent.id;
      }

      if (suggestion.isNew) {
        // 소분류도 새것 → 생성 후 선택
        const newCat = await onCategoryCreate(suggestion.categoryName, transactionType, parentId);
        if (newCat) {
          setSelectedCategory(newCat);
          setActiveRootId(parentId ?? newCat.id);
        }
      } else {
        // 기존 소분류 선택
        const existing = categoriesRef.current.find(
          (c) => c.id == suggestion.categoryId || (c.name === suggestion.categoryName && c.parent_id == parentId)
        );
        if (existing) {
          setSelectedCategory(existing);
          setActiveRootId(existing.parent_id ?? existing.id);
        }
      }
    } finally {
      setApplyingNew(false);
      setSuggestion(null);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (value === '') { setAmount(''); return; }
    const numericValue = Number(value);
    if (!isNaN(numericValue)) setAmount(numericValue.toLocaleString('ko-KR'));
  };

  // 영수증 이미지 분석 요청
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);

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
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('transactionType', transactionTypeRef.current);
      
      const type = transactionTypeRef.current;
      const filtered = categoriesRef.current.filter((c) => c.type === type);
      const roots = filtered.filter((c) => !c.parent_id);
      const baseRoots = roots.length > 0 ? roots : categoriesRef.current.filter((c) => !c.parent_id);
      const baseCats  = roots.length > 0 ? filtered : categoriesRef.current;
      const tree = baseRoots.map((root) => ({
        id: root.id,
        name: root.name,
        subCategories: baseCats.filter((c) => c.parent_id === root.id).map((c) => ({ id: c.id, name: c.name })),
      }));
      formData.append('categories', JSON.stringify(tree));

      const res = await fetch('/api/analyze-receipt', { method: 'POST', body: formData });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`서버 응답 오류 (${res.status}): ${errorText}`);
      }
      const data = await res.json();
      
      if (data.multipleDates) {
        setMultipleDatesWarning(true);
        return;
      }
      setMultipleDatesWarning(false);
      if (data.description) setDescription(data.description);
      if (data.amount) setAmount(Number(data.amount).toLocaleString('ko-KR'));
      if (data.date) setTransactedAt(data.date);
      if (data.categoryName) setSuggestion(data); // 기존 카테고리 제안 UI 활용
    } catch (error) {
      console.error('영수증 분석 API 에러 상세:', error);
      alert('영수증 분석 중 오류가 발생했습니다. (F12 개발자 도구의 콘솔을 확인해주세요)');
    } finally {
      setImageUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const rootCategories = filteredCategories.filter((c) => !c.parent_id);
  const resolvedRootId = activeRootId ?? rootCategories[0]?.id;
  const subCategories = filteredCategories.filter((c) => c.parent_id === resolvedRootId);
  const activeRoot = rootCategories.find((r) => r.id === resolvedRootId);
  const isTransferCategory = activeRoot?.is_system === true;

  // 이체 카테고리 선택 시 소분류 패널에 표시할 자산 목록 (출금 자산 제외)
  const transferTargetAssets = isTransferCategory
    ? assets.filter((a) => {
        if (a.id === selectedAsset?.id) return false;
        if (activeRoot?.name === '카드정산') return a.type === 'CARD';
          return a.type !== 'CARD';
      })
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTransferCategory) {
      if (!transferTargetAsset) {
        alert('이체할 대상 자산/계좌를 선택해주세요.');
        return;
      }
      onSubmit({ type: transactionType, amount, selectedAsset, selectedCategory, billingDate, transactedAt, description, transferTargetAsset });
      return;
    }
    // 선택된 루트가 소분류를 가지고 있는데 루트 자체가 선택된 경우 경고
    if (subCategories.length > 0 && selectedCategory?.id === resolvedRootId && !selectedCategory?.parent_id) {
      alert('소분류 카테고리를 선택해주세요.');
      return;
    }
    onSubmit({ type: transactionType, amount, selectedAsset, selectedCategory, billingDate, transactedAt, description });
  };

  const isExpense = transactionType === 'EXPENSE';

  const ASSET_TYPE_LABEL: Record<string, string> = {
    CASH: '현금', BANK: '은행', CHECKING: '입출금', SAVINGS: '적금',
    DEPOSIT: '예금', INVESTMENT: '투자', STOCK: '주식', PENSION: '연금',
    INSURANCE: '보험', REAL_ESTATE: '부동산', LOAN: '대출', OTHER_LIABILITY: '기타',
  };
  const cardAssets = assets.filter((a) => a.type === 'CARD');
  const cashAssets = assets.filter((a) => a.type !== 'CARD');
  const paymentAssets = isExpense ? (paymentMode === 'CARD' ? cardAssets : cashAssets) : assets;

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-2xl shadow-lg border border-gray-100">
      {/* 지출 / 수입 토글 */}
      <div className="flex mb-6 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => setTransactionType('EXPENSE')}
          className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors ${
            isExpense ? 'bg-white text-red-500 shadow-sm' : 'text-gray-400'
          }`}
        >
          지출
        </button>
        <button
          type="button"
          onClick={() => setTransactionType('INCOME')}
          className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors ${
            !isExpense ? 'bg-white text-blue-500 shadow-sm' : 'text-gray-400'
          }`}
        >
          수입
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* 거래일 */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">거래일</label>
          <input
            type="date"
            value={transactedAt}
            onChange={(e) => setTransactedAt(e.target.value)}
            className="w-full p-3 bg-gray-50 text-gray-800 font-semibold rounded-xl border-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 적요 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-bold text-gray-700">적요</label>
            <button
              type="button"
              onClick={() => setImageSourcePickerOpen(true)}
              disabled={imageUploading}
              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-600 font-medium rounded-lg border border-blue-100 hover:bg-blue-100 disabled:opacity-50 transition-colors flex items-center gap-1"
            >
              {imageUploading ? <span className="inline-block w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /> : '📸'}
              {imageUploading ? '분석 중...' : '영수증 인식'}
            </button>
            <input type="file" accept="image/*" capture="environment" className="hidden" ref={cameraInputRef} onChange={handleImageUpload} />
            <input type="file" accept="image/*" className="hidden" ref={galleryInputRef} onChange={handleImageUpload} />
          </div>
          {multipleDatesWarning && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
              <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-700">여러 건의 영수증이 감지되었습니다</p>
                <p className="text-xs text-amber-600 mt-0.5">2개 이상의 거래 일자가 확인됩니다. 다건 등록은 <a href="/settings/bulk-entry" className="underline font-bold">일괄 등록</a> 기능을 이용해 주세요.</p>
              </div>
              <button type="button" onClick={() => setMultipleDatesWarning(false)} className="text-amber-400 hover:text-amber-600 text-sm leading-none shrink-0">✕</button>
            </div>
          )}
          <input
            type="text"
            value={description}
            onChange={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            placeholder="거래 내용을 입력하세요 (예: 스타벅스 아메리카노)"
            className="w-full p-3 bg-gray-50 text-gray-800 font-medium rounded-xl border-none focus:ring-2 focus:ring-blue-500"
          />
          {/* AI 카테고리 제안 */}
          {suggestLoading && (
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
              <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
              AI가 카테고리를 분석 중...
            </p>
          )}
          {suggestion && !suggestLoading && (
            <div className="mt-2 p-3 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
              {/* 카테고리 경로 표시 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-lg leading-none">💡</span>
                {suggestion.parentName && (
                  <>
                    <span className="text-xs font-bold text-gray-700">{suggestion.parentName}</span>
                    <span className="text-xs text-gray-400">›</span>
                  </>
                )}
                <span className="text-xs font-bold text-blue-700">{suggestion.categoryName}</span>
                {suggestion.isNew && (
                  <span className="text-[11px] bg-blue-100 text-blue-500 px-1.5 py-0.5 rounded-full font-medium">새 소분류</span>
                )}
              </div>
              {/* 새 소분류 추가 안내 */}
              {suggestion.isNew && (
                <p className="text-xs text-gray-500">소분류를 새로 추가하고 적용할까요?</p>
              )}
              {/* 액션 버튼 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applySuggestion}
                  disabled={applyingNew}
                  className="text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-3 py-1.5 rounded-lg"
                >
                  {applyingNew ? '처리 중...' : suggestion.isNew ? '추가 & 적용' : '적용'}
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestion(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                >
                  무시
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 금액 */}
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-1">금액</label>
          <input
            type="text"
            className={`w-full text-3xl font-bold border-b-2 focus:outline-none pb-2 ${
              isExpense ? 'text-red-500 border-red-400' : 'text-blue-500 border-blue-400'
            }`}
            placeholder="0"
            value={amount}
            onChange={handleAmountChange}
          />
        </div>

        {/* 결제/입금 수단 */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            {isExpense ? '결제 수단' : '입금 계좌'}
          </label>
          {isExpense && (
            <div className="flex mb-2 bg-gray-100 rounded-xl p-1">
              <button
                type="button"
                onClick={() => {
                  setPaymentMode('CARD');
                  setSelectedAsset(cardAssets[0]);
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                  paymentMode === 'CARD' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'
                }`}
              >
                카드
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaymentMode('CASH');
                  setSelectedAsset(cashAssets[0]);
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                  paymentMode === 'CASH' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'
                }`}
              >
                현금
              </button>
            </div>
          )}
          <select
            value={selectedAsset?.id || ''}
            className="w-full p-3 bg-gray-50 text-gray-800 font-medium rounded-xl border-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setSelectedAsset(paymentAssets.find((a) => a.id === e.target.value))}
          >
            {paymentAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {isExpense && paymentMode === 'CASH'
                  ? `${ASSET_TYPE_LABEL[asset.type] ?? asset.type}>${asset.name}`
                  : asset.name}
              </option>
            ))}
          </select>
          {billingDate && (
            <p className="mt-2 text-xs text-blue-600 font-medium">
              ℹ️ 이 지출은 {billingDate.getMonth() + 1}월 {billingDate.getDate()}일에 결제될 예정입니다.
            </p>
          )}
        </div>

        {/* 카테고리 */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            카테고리
            {isTransferCategory ? (
              <span className="ml-2 text-xs font-normal text-blue-500">
                {transferTargetAsset
                  ? `이체/대체 › ${transferTargetAsset.name}`
                  : '이체/대체 — 대상 자산 선택'}
              </span>
            ) : selectedCategory && (
              <span className="ml-2 text-xs font-normal text-blue-500">
                {selectedCategory.parent_id
                  ? `${rootCategories.find(r => r.id === selectedCategory.parent_id)?.name} › ${selectedCategory.name}`
                  : selectedCategory.name}
              </span>
            )}
          </label>
          <div className="flex border border-gray-200 rounded-xl overflow-hidden" style={{ height: '11rem' }}>
            {/* 대분류 패널 */}
            <div className="w-2/5 border-r border-gray-100 overflow-y-auto bg-gray-50 flex flex-col">
              {rootCategories.map((root) => {
                const isActive = resolvedRootId === root.id;
                return (
                  <button
                    type="button"
                    key={root.id}
                    onClick={() => {
                      setActiveRootId(root.id);
                      const hasSubs = filteredCategories.some((c) => c.parent_id === root.id);
                      if (!hasSubs) setSelectedCategory(root);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-100 last:border-0 flex items-center justify-between shrink-0 transition-colors ${
                      isActive ? 'bg-white text-blue-600 font-bold' : 'text-gray-600 hover:bg-white'
                    }`}
                  >
                    <span className="truncate">{root.name}</span>
                    {isActive && <span className="text-blue-300 ml-1">›</span>}
                  </button>
                );
              })}
            </div>
            {/* 소분류 패널 */}
            <div className="flex-1 overflow-y-auto bg-white flex flex-col">
              {isTransferCategory ? (
                transferTargetAssets.length > 0 ? (
                  transferTargetAssets.map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      onClick={() => setTransferTargetAsset(asset)}
                      className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-100 last:border-0 shrink-0 transition-colors ${
                        transferTargetAsset?.id === asset.id
                          ? 'bg-blue-50 text-blue-600 font-bold'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {asset.name}
                    </button>
                  ))
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-gray-300 text-center px-2">
                    이체 가능한<br />자산이 없습니다
                  </div>
                )
              ) : subCategories.length > 0 ? (
                subCategories.map((sub) => (
                  <button
                    type="button"
                    key={sub.id}
                    onClick={() => setSelectedCategory(sub)}
                    className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-100 last:border-0 shrink-0 transition-colors ${
                      selectedCategory?.id === sub.id
                        ? 'bg-blue-50 text-blue-600 font-bold'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {sub.name}
                  </button>
                ))
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-gray-300">
                  소분류 없음
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={`w-full py-4 text-white font-bold rounded-2xl transition-colors shadow-lg ${
            isExpense ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
          }`}
        >
          {isExpense ? '지출 저장하기' : '수입 저장하기'}
        </button>
      </form>

      {/* 사진 가져오기 선택 모달 */}
      {imageSourcePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setImageSourcePickerOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-64 p-4 flex flex-col gap-2">
            <h3 className="text-base font-bold text-gray-800 mb-2 text-center">사진 가져오기</h3>
            <button
              type="button"
              onClick={() => { setImageSourcePickerOpen(false); cameraInputRef.current?.click(); }}
              className="w-full py-3 bg-blue-50 text-blue-600 font-bold rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
            >
              <span>📷</span> 카메라로 촬영
            </button>
            <button
              type="button"
              onClick={() => { setImageSourcePickerOpen(false); galleryInputRef.current?.click(); }}
              className="w-full py-3 bg-gray-50 text-gray-700 font-bold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
            >
              <span>🖼️</span> 갤러리에서 선택
            </button>
            <button
              type="button"
              onClick={() => setImageSourcePickerOpen(false)}
              className="w-full py-2 text-gray-400 font-medium text-sm mt-1 hover:text-gray-600 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseForm;
