'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { PREV_MONTH_BILLING_SENTINEL } from '@/utils/dateCalc';

type CardType = 'CREDIT' | 'CHECK';

export interface CardFormValues {
  name: string;
  card_type: CardType;
  settlement_day: number;
  billing_start_offset: number;
  billing_end_offset: number;
  linked_asset_id: string | null;
}

interface BankAsset { id: string; name: string; type: string; }

const ASSET_TYPE_LABEL: Record<string, string> = {
  CASH: '현금', CHECKING: '자유입출금', STOCK: '주식', DEPOSIT: '예금',
  SAVINGS: '적금', PENSION: '연금', INSURANCE: '보험', REAL_ESTATE: '부동산',
  LOAN: '대출', OTHER_LIABILITY: '기타부채',
};

const SETTLEMENT_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const BILLING_START_PRESETS: { label: string; value: number | null }[] = [
  { label: '전달 25일부터 (-6일)',          value: -6 },
  { label: '전달 16일부터 (-14일)',          value: -14 },
  { label: '전달 15일부터 (-15일)',          value: -15 },
  { label: '전달 1일부터 (~말일)',           value: PREV_MONTH_BILLING_SENTINEL },
  { label: '결제일 당월 1일부터',            value: -31 },
  { label: '직접 입력',                     value: null },
];

export default function CardForm({
  initial,
  onSave,
  saving,
}: {
  initial?: any;
  onSave: (values: CardFormValues) => void;
  saving: boolean;
}) {
  const isEdit = !!initial;
  const cd = initial?.card_details;

  const [name, setName] = useState(initial?.name ?? '');
  const [cardType, setCardType] = useState<CardType>(cd?.card_type ?? 'CREDIT');
  const [settlementDay, setSettlementDay] = useState<number>(cd?.settlement_day ?? 15);
  const [billingStartOffset, setBillingStartOffset] = useState<number>(cd?.billing_start_offset ?? -14);
  const [linkedAssetId, setLinkedAssetId] = useState<string>(cd?.linked_asset_id ?? '');
  const [customOffset, setCustomOffset] = useState(false);
  const [bankAssets, setBankAssets] = useState<BankAsset[]>([]);

  useEffect(() => {
    supabase
      .from('assets')
      .select('id, name, type')
      .not('type', 'eq', 'CARD')
      .eq('is_active', true)
      .order('type')
      .order('name')
      .then(({ data }) => { if (data) setBankAssets(data); });
  }, []);

  const presetMatch = BILLING_START_PRESETS.find(
    (p) => p.value === billingStartOffset && p.value !== null
  );

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === 'custom') {
      setCustomOffset(true);
    } else {
      setCustomOffset(false);
      setBillingStartOffset(Number(e.target.value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      card_type: cardType,
      settlement_day: settlementDay,
      billing_start_offset: billingStartOffset,
      billing_end_offset: 0,
      linked_asset_id: cardType === 'CREDIT' ? linkedAssetId || null : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
        <p className="text-sm font-semibold text-gray-500">기본 정보</p>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">카드 이름</label>
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 신한카드 Deep Dream"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-2 block">카드 종류</label>
          <div className="flex gap-2">
            {(['CREDIT', 'CHECK'] as CardType[]).map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setCardType(ct)}
                className={`flex-1 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors ${
                  cardType === ct
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {ct === 'CREDIT' ? '신용카드' : '체크카드'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 결제 설정 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
        <p className="text-sm font-semibold text-gray-500">결제 설정</p>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">결제일</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">매월</span>
            <select
              value={settlementDay}
              onChange={(e) => setSettlementDay(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SETTLEMENT_DAYS.map((d) => (
                <option key={d} value={d}>{d}일</option>
              ))}
            </select>
            <span className="text-sm text-gray-500">결제</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            공여기간 (청구 시작일)
            <span className="ml-1 text-gray-300">· 결제일 기준</span>
          </label>
          {!customOffset ? (
            <select
              value={presetMatch ? String(presetMatch.value) : 'custom'}
              onChange={handlePresetChange}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BILLING_START_PRESETS.map((p) => (
                <option key={p.label} value={p.value !== null ? String(p.value) : 'custom'}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">결제일</span>
              <input
                type="number"
                max={0}
                value={billingStartOffset}
                onChange={(e) => setBillingStartOffset(Number(e.target.value))}
                className="w-20 px-3 py-2 rounded-xl border border-gray-200 text-sm text-center text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">일 전부터</span>
              <button type="button" onClick={() => setCustomOffset(false)} className="text-xs text-blue-500 ml-auto">
                프리셋 선택
              </button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {billingStartOffset === PREV_MONTH_BILLING_SENTINEL
              ? '청구 범위: 결제월 전달 1일 ~ 말일'
              : `청구 시작: 결제일 ${Math.abs(billingStartOffset)}일 전부터`}
          </p>
        </div>

        {cardType === 'CREDIT' && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">자동이체 연결 계좌 (선택)</label>
            <select
              value={linkedAssetId}
              onChange={(e) => setLinkedAssetId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">없음</option>
              {bankAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({ASSET_TYPE_LABEL[a.type] ?? a.type})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-200"
      >
        {saving ? '저장 중...' : isEdit ? '변경 사항 저장' : '카드 추가'}
      </button>
    </form>
  );
}
