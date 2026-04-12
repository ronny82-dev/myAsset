'use client';
import { useState } from 'react';

export type AssetType =
  | 'CASH' | 'CHECKING'
  | 'STOCK' | 'DEPOSIT' | 'SAVINGS' | 'PENSION'
  | 'INSURANCE' | 'REAL_ESTATE'
  | 'LOAN' | 'OTHER_LIABILITY';

export interface AssetFormValues {
  name: string;
  type: AssetType;
  initial_balance: number;
}

const ASSET_GROUPS: { label: string; types: { type: AssetType; label: string; desc: string }[] }[] = [
  {
    label: '자산',
    types: [
      { type: 'CASH',        label: '현금',     desc: '' },
      { type: 'CHECKING',    label: '자유입출금', desc: '은행 입출금 계좌' },
      { type: 'STOCK',       label: '주식',     desc: '증권 계좌' },
      { type: 'DEPOSIT',     label: '예금',     desc: '정기예금' },
      { type: 'SAVINGS',     label: '적금',     desc: '정기적금' },
      { type: 'PENSION',     label: '연금',     desc: 'IRP·퇴직연금 등' },
      { type: 'INSURANCE',   label: '보험',     desc: '저축·변액보험 등' },
      { type: 'REAL_ESTATE', label: '부동산',   desc: '아파트·토지 등' },
    ],
  },
  {
    label: '부채',
    types: [
      { type: 'LOAN',             label: '대출',   desc: '주담대·신용대출 등' },
      { type: 'OTHER_LIABILITY',  label: '기타부채', desc: '' },
    ],
  },
];

const ALL_TYPES = ASSET_GROUPS.flatMap((g) => g.types);

const PLACEHOLDER: Partial<Record<AssetType, string>> = {
  CHECKING:    '예: 신한은행 입출금',
  STOCK:       '예: 삼성증권',
  DEPOSIT:     '예: 국민은행 정기예금',
  SAVINGS:     '예: 하나은행 적금',
  PENSION:     '예: 퇴직연금 IRP',
  INSURANCE:   '예: 삼성생명 저축보험',
  REAL_ESTATE: '예: 강남구 아파트',
  LOAN:        '예: 주택담보대출',
};

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
  const [type, setType] = useState<AssetType>(initial?.type ?? 'CHECKING');
  const [initialBalance, setInitialBalance] = useState<string>(
    initial?.initial_balance != null ? String(initial.initial_balance) : ''
  );

  const isLiability = type === 'LOAN' || type === 'OTHER_LIABILITY';
  const typeInfo = ALL_TYPES.find((t) => t.type === type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, type, initial_balance: Number(initialBalance) || 0 });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 자산 종류 */}
      {!isEdit && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          {ASSET_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="text-xs font-semibold text-gray-400 mb-2">{group.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {group.types.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setType(t.type)}
                    className={`py-3 px-3 text-left rounded-xl border-2 transition-colors ${
                      type === t.type
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${type === t.type ? 'text-blue-700' : 'text-gray-700'}`}>
                      {t.label}
                    </p>
                    {t.desc && (
                      <p className={`text-xs mt-0.5 ${type === t.type ? 'text-blue-400' : 'text-gray-400'}`}>
                        {t.desc}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
        {isEdit && (
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">{typeInfo?.label}</span>
            {typeInfo?.desc && <span className="text-xs text-gray-400">{typeInfo.desc}</span>}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">이름</label>
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={PLACEHOLDER[type] ?? '이름 입력'}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            {isLiability ? '시작 부채 금액 (원)' : '시작 금액 (원)'}
          </label>
          <input
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            {isLiability
              ? '거래 내역과 별개로 설정하는 초기 부채 금액입니다.'
              : '거래 내역과 별개로 설정하는 초기 잔액입니다.'}
          </p>
        </div>
      </div>

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
