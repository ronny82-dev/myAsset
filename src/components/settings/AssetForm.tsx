'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';

type AssetType = 'CASH' | 'BANK' | 'CARD' | 'INVESTMENT';
type CardType = 'CREDIT' | 'CHECK';

interface CardDetails {
  card_type: CardType;
  settlement_day: number;
  billing_start_offset: number;
  billing_end_offset: number;
  linked_asset_id: string | null;
}

interface AssetFormValues {
  name: string;
  type: AssetType;
  balance: number;
  cardDetails?: CardDetails;
}

interface BankAsset { id: string; name: string; }

const TYPE_LABELS: Record<AssetType, string> = {
  CASH: '현금', BANK: '은행 계좌', CARD: '신용/체크카드', INVESTMENT: '투자',
};

const SETTLEMENT_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

// billing_start_offset 사용자 친화적 옵션
// "결제일 N일 전부터 청구 시작"
const BILLING_START_PRESETS = [
  { label: '결제일 당월 1일부터 (당월 전체)', value: -30 },
  { label: '전달 25일부터 (-6일)', value: -6 },
  { label: '전달 16일부터 (-14일)', value: -14 },
  { label: '전달 15일부터 (-15일)', value: -15 },
  { label: '전달 1일부터 (-30일)', value: -30 },
  { label: '직접 입력', value: null },
];

export default function AssetForm({
  initial,
  onSave,
  saving,
}: {
  initial?: any;
  onSave: (values: AssetFormValues) => void;
  saving: boolean;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AssetType>(initial?.type ?? 'BANK');
  const [balance, setBalance] = useState<string>(
    initial?.balance != null ? String(initial.balance) : ''
  );

  // 카드 상세
  const cd = initial?.card_details;
  const [cardType, setCardType] = useState<CardType>(cd?.card_type ?? 'CREDIT');
  const [settlementDay, setSettlementDay] = useState<number>(cd?.settlement_day ?? 15);
  const [billingStartOffset, setBillingStartOffset] = useState<number>(cd?.billing_start_offset ?? -14);
  const [billingEndOffset] = useState<number>(cd?.billing_end_offset ?? 0);
  const [linkedAssetId, setLinkedAssetId] = useState<string>(cd?.linked_asset_id ?? '');
  const [customOffset, setCustomOffset] = useState(false);
  const [bankAssets, setBankAssets] = useState<BankAsset[]>([]);

  useEffect(() => {
    if (type === 'CARD') {
      supabase
        .from('assets')
        .select('id, name')
        .in('type', ['BANK', 'CASH'])
        .eq('is_active', true)
        .then(({ data }) => { if (data) setBankAssets(data); });
    }
  }, [type]);

  // preset 선택 감지
  const presetValue = BILLING_START_PRESETS.find((p) => p.value === billingStartOffset && p.value !== null)?.value ?? null;

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'custom') {
      setCustomOffset(true);
    } else {
      setCustomOffset(false);
      setBillingStartOffset(Number(val));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const values: AssetFormValues = {
      name,
      type,
      balance: Number(balance) || 0,
    };
    if (type === 'CARD') {
      values.cardDetails = {
        card_type: cardType,
        settlement_day: settlementDay,
        billing_start_offset: billingStartOffset,
        billing_end_offset: billingEndOffset,
        linked_asset_id: linkedAssetId || null,
      };
    }
    onSave(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 자산 종류 */}
      {!isEdit && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-500 mb-3">자산 종류</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABELS) as AssetType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`py-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                  type === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
        <p className="text-sm font-semibold text-gray-500">기본 정보</p>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">이름</label>
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'CARD' ? '예: 신한카드' : '예: 신한은행'}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {type !== 'CARD' && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">잔액 (원)</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* 카드 상세 */}
      {type === 'CARD' && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm font-semibold text-gray-500">카드 상세 설정</p>

          {/* 카드 종류 */}
          <div>
            <label className="text-xs text-gray-400 mb-2 block">카드 종류</label>
            <div className="flex gap-2">
              {(['CREDIT', 'CHECK'] as CardType[]).map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setCardType(ct)}
                  className={`flex-1 py-2 text-sm font-medium rounded-xl border-2 transition-colors ${
                    cardType === ct ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {ct === 'CREDIT' ? '신용카드' : '체크카드'}
                </button>
              ))}
            </div>
          </div>

          {/* 결제일 */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">결제일</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">매월</span>
              <select
                value={settlementDay}
                onChange={(e) => setSettlementDay(Number(e.target.value))}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SETTLEMENT_DAYS.map((d) => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
              <span className="text-sm text-gray-500">결제</span>
            </div>
          </div>

          {/* 청구 시작일 */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              공여기간 (청구 시작일)
              <span className="ml-1 text-gray-300">· 결제일 기준</span>
            </label>
            {!customOffset ? (
              <select
                value={presetValue !== null ? String(presetValue) : 'custom'}
                onChange={handlePresetChange}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-20 px-3 py-2 rounded-xl border border-gray-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">일 전부터</span>
                <button type="button" onClick={() => setCustomOffset(false)} className="text-xs text-blue-500 ml-auto">프리셋 선택</button>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">
              예상 청구 시작: 결제일 {Math.abs(billingStartOffset)}일 전 ({billingStartOffset === 0 ? '결제일 당일' : `결제일 ${Math.abs(billingStartOffset)}일 전`}부터)
            </p>
          </div>

          {/* 연결 계좌 (신용카드만) */}
          {cardType === 'CREDIT' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">자동이체 연결 계좌 (선택)</label>
              <select
                value={linkedAssetId}
                onChange={(e) => setLinkedAssetId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">없음</option>
                {bankAssets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* 저장 버튼 */}
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-200"
      >
        {saving ? '저장 중...' : isEdit ? '변경 사항 저장' : '자산 추가'}
      </button>
    </form>
  );
}
