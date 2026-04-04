'use client';
import React, { useState, useEffect, useRef } from 'react';
import { calculateExpectedBillingDate } from '@/utils/dateCalc';

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
  members: Member[];
  onSubmit: (data: {
    type: TransactionType;
    amount: string;
    selectedAsset?: Asset;
    selectedCategory?: Category;
    payer?: Member;
    billingDate?: Date | null;
    transactedAt: string;
    description?: string;
  }) => void;
  onCategoryCreate: (name: string, type: TransactionType, parentId?: string | number | null) => Promise<Category | null>;
}

const ExpenseForm = ({ assets, categories, members, onSubmit, onCategoryCreate }: ExpenseFormProps) => {
  const [transactionType, setTransactionType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState<string>('');
  const [transactedAt, setTransactedAt] = useState<string>(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState<string>('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | undefined>(assets?.[0]);
  const [selectedCategory, setSelectedCategory] = useState<Category | undefined>();
  const [payer, setPayer] = useState<Member | undefined>(members?.[0]);
  const [billingDate, setBillingDate] = useState<Date | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [applyingNew, setApplyingNew] = useState(false);

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
    setSuggestion(null);
    setSuggestLoading(false);
  }, [transactionType]);

  // 초기 카테고리 설정
  useEffect(() => {
    if (!selectedCategory) {
      const roots = categories.filter((c) => c.type === transactionType && !c.parent_id);
      setSelectedCategory(roots[0]);
    }
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
    setSuggestLoading(true);
    setSuggestion(null);
    try {
      // API에 계층 구조로 카테고리 정보를 전달
      const filtered = categoriesRef.current.filter((c) => c.type === type);
      const roots = filtered.filter(c => !c.parent_id);
      const tree = roots.map(root => ({
        id: root.id,
        name: root.name,
        subCategories: filtered.filter(c => c.parent_id === root.id).map(c => ({ id: c.id, name: c.name }))
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

    let parentId = suggestion.parentId;

    // 상위 카테고리가 없는 경우 먼저 확인 후 생성
    if (!parentId && suggestion.parentName) {
      const existingParent = categoriesRef.current.find(c => c.name === suggestion.parentName && !c.parent_id);
      if (existingParent) {
        parentId = existingParent.id;
      } else {
        const newParent = await onCategoryCreate(suggestion.parentName, transactionType, null);
        if (newParent) parentId = newParent.id;
      }
    }

    if (suggestion.isNew) {
      const newCat = await onCategoryCreate(suggestion.categoryName, transactionType, parentId);
      if (newCat) setSelectedCategory(newCat);
    } else {
      const existing = categoriesRef.current.find(
        (c) => (c.id == suggestion.categoryId || c.name === suggestion.categoryName) && c.parent_id == parentId
      );
      if (existing) setSelectedCategory(existing);
    }
    setApplyingNew(false);
    setSuggestion(null);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (value === '') { setAmount(''); return; }
    const numericValue = Number(value);
    if (!isNaN(numericValue)) setAmount(numericValue.toLocaleString('ko-KR'));
  };

  const rootCategories = filteredCategories.filter((c) => !c.parent_id);
  const activeRootId = selectedCategory?.parent_id || selectedCategory?.id || rootCategories[0]?.id;
  const subCategories = filteredCategories.filter((c) => c.parent_id === activeRootId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (subCategories.length > 0 && !selectedCategory?.parent_id) {
      alert('상세 하위 카테고리를 선택해주세요.');
      return;
    }
    onSubmit({ type: transactionType, amount, selectedAsset, selectedCategory, payer, billingDate, transactedAt, description });
  };

  const isExpense = transactionType === 'EXPENSE';

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
          <label className="block text-sm font-bold text-gray-700 mb-2">적요</label>
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
            <div className="mt-2 flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
              <span className="text-xs text-blue-700 flex-1 leading-relaxed">
                💡 <strong>{suggestion.parentName} &gt; {suggestion.categoryName}</strong>
                {suggestion.isNew && (
                  <span className="ml-1.5 text-[11px] bg-blue-100 text-blue-500 px-1.5 py-0.5 rounded-full font-medium">
                    새 카테고리
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={applySuggestion}
                disabled={applyingNew}
                className="text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-3 py-1.5 rounded-lg shrink-0"
              >
                {applyingNew ? '추가 중...' : '적용'}
              </button>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="text-xs text-gray-400 hover:text-gray-600 px-1 shrink-0"
              >
                무시
              </button>
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
          <select
            value={selectedAsset?.id || ''}
            className="w-full p-3 bg-gray-50 text-gray-800 font-medium rounded-xl border-none focus:ring-2 focus:ring-blue-500"
            onChange={(e) => setSelectedAsset(assets.find((a) => a.id === e.target.value))}
          >
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
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
          <label className="block text-sm font-bold text-gray-700 mb-2">카테고리</label>
          <div className="flex overflow-x-auto space-x-2 mb-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {rootCategories.map((root) => (
              <button
                type="button"
                key={root.id}
                onClick={() => setSelectedCategory(root)}
                className={`whitespace-nowrap px-4 py-2 text-sm font-bold rounded-full transition-colors ${
                  activeRootId === root.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {root.name}
              </button>
            ))}
          </div>
          {subCategories.length > 0 && (
            <div className="grid grid-cols-4 gap-2 p-3 bg-gray-50 rounded-xl">
              {subCategories.map((sub) => (
                <button
                  type="button"
                  key={sub.id}
                  onClick={() => setSelectedCategory(sub)}
                  className={`p-2 text-xs font-semibold rounded-lg border transition-colors ${
                    selectedCategory?.id === sub.id
                      ? 'bg-blue-500 text-white border-blue-500 shadow-md'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 결제/수취 주체 */}
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            {isExpense ? '누가 결제했나요?' : '누가 받았나요?'}
          </label>
          <div className="flex space-x-4">
            {members.map((m) => (
              <label key={m.id} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="payer"
                  checked={payer?.id === m.id}
                  onChange={() => setPayer(m)}
                  className="text-blue-500"
                />
                <span className="text-sm font-medium text-gray-800">{m.nickname}</span>
              </label>
            ))}
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
    </div>
  );
};

export default ExpenseForm;
