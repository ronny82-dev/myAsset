'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase';

type AssetType =
  | 'CASH' | 'CHECKING'
  | 'STOCK' | 'DEPOSIT' | 'SAVINGS' | 'PENSION'
  | 'INSURANCE' | 'REAL_ESTATE'
  | 'LOAN' | 'OTHER_LIABILITY';

interface Asset {
  id: string;
  name: string;
  type: AssetType;
  initial_balance: number;
  balance: number;
  is_active: boolean;
}

const TYPE_LABEL: Record<AssetType, string> = {
  CASH:            '현금',
  CHECKING:        '자유입출금',
  STOCK:           '주식',
  DEPOSIT:         '예금',
  SAVINGS:         '적금',
  PENSION:         '연금',
  INSURANCE:       '보험',
  REAL_ESTATE:     '부동산',
  LOAN:            '대출',
  OTHER_LIABILITY: '기타부채',
};

const TYPE_COLOR: Record<AssetType, string> = {
  CASH:            'bg-green-100 text-green-700',
  CHECKING:        'bg-blue-100 text-blue-700',
  STOCK:           'bg-purple-100 text-purple-700',
  DEPOSIT:         'bg-indigo-100 text-indigo-700',
  SAVINGS:         'bg-sky-100 text-sky-700',
  PENSION:         'bg-violet-100 text-violet-700',
  INSURANCE:       'bg-orange-100 text-orange-700',
  REAL_ESTATE:     'bg-amber-100 text-amber-700',
  LOAN:            'bg-red-100 text-red-600',
  OTHER_LIABILITY: 'bg-gray-100 text-gray-600',
};

const LIABILITY_TYPES: AssetType[] = ['LOAN', 'OTHER_LIABILITY'];
const ASSET_SECTION: AssetType[] = ['CASH', 'CHECKING', 'STOCK', 'DEPOSIT', 'SAVINGS', 'PENSION', 'INSURANCE', 'REAL_ESTATE'];
const LIABILITY_SECTION: AssetType[] = ['LOAN', 'OTHER_LIABILITY'];

function AssetCard({ asset, onToggleActive, onBalanceChange }: {
  asset: Asset;
  onToggleActive: (asset: Asset) => void;
  onBalanceChange: (asset: Asset, newInitialBalance: number) => void;
}) {
  const isLiability = LIABILITY_TYPES.includes(asset.type);
  const [inputVal, setInputVal] = useState(String(asset.initial_balance));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const prevVal = useRef(String(asset.initial_balance));

  const handleBlur = async () => {
    const num = Number(inputVal) || 0;
    if (String(num) === prevVal.current) return;
    setSaving(true);
    await onBalanceChange(asset, num);
    prevVal.current = String(num);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className={`bg-white rounded-2xl border p-3 flex flex-col gap-2 shadow-sm transition-opacity ${!asset.is_active ? 'opacity-40' : 'border-gray-100'}`}>
      {/* 헤더: 타입 배지 + 토글 */}
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_COLOR[asset.type]}`}>
          {TYPE_LABEL[asset.type]}
        </span>
        <button
          type="button"
          onClick={() => onToggleActive(asset)}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${asset.is_active ? 'bg-blue-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${asset.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* 자산명 */}
      <div className="flex items-center justify-between gap-1">
        <p className="text-sm font-semibold text-gray-800 truncate flex-1">{asset.name}</p>
        <Link
          href={`/settings/assets/${asset.id}`}
          className="text-[10px] text-gray-300 hover:text-blue-400 shrink-0"
        >
          편집
        </Link>
      </div>

      {/* 시작금액 인라인 입력 */}
      <div>
        <label className="text-[10px] text-gray-400 block mb-0.5">
          {isLiability ? '시작 부채금액' : '시작금액'}
        </label>
        <div className="relative">
          <input
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={handleBlur}
            className={`w-full px-2 py-1.5 rounded-lg border text-xs text-right text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 ${isLiability ? 'border-red-100 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
          />
          {saving && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-400">저장 중</span>
          )}
          {saved && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-blue-500">저장됨</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssets = async () => {
    setLoading(true);
    let { data, error } = await supabase
      .from('assets')
      .select('id, name, type, initial_balance, balance, is_active')
      .not('type', 'eq', 'CARD')
      .order('type')
      .order('name');

    // initial_balance 컬럼이 없는 경우 balance로 대체하여 재조회
    if (error) {
      console.warn('initial_balance 컬럼 없음, fallback 조회:', error.message);
      const fallback = await supabase
        .from('assets')
        .select('id, name, type, balance, is_active')
        .not('type', 'eq', 'CARD')
        .order('type')
        .order('name');
      data = fallback.data;
    }

    if (data) {
      setAssets(data.map((a: any) => ({
        ...a,
        initial_balance: a.initial_balance ?? a.balance ?? 0,
      })) as Asset[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAssets(); }, []);

  const handleToggleActive = async (asset: Asset) => {
    await supabase.from('assets').update({ is_active: !asset.is_active }).eq('id', asset.id);
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, is_active: !asset.is_active } : a));
  };

  const handleBalanceChange = async (asset: Asset, newInitialBalance: number) => {
    const diff = newInitialBalance - asset.initial_balance;
    const newBalance = asset.balance + diff;
    const { error } = await supabase.from('assets').update({
      initial_balance: newInitialBalance,
      balance: newBalance,
    }).eq('id', asset.id);
    // initial_balance 컬럼 없으면 balance만 저장
    if (error) {
      await supabase.from('assets').update({ balance: newBalance }).eq('id', asset.id);
    }
    setAssets((prev) => prev.map((a) =>
      a.id === asset.id ? { ...a, initial_balance: newInitialBalance, balance: newBalance } : a
    ));
  };

  const renderSection = (title: string, types: AssetType[]) => {
    const list = assets.filter((a) => types.includes(a.type));
    if (list.length === 0) return null;

    return (
      <div key={title}>
        <p className="text-xs font-bold text-gray-400 px-1 mb-2 uppercase tracking-wide">{title}</p>
        <div className="grid grid-cols-2 gap-2">
          {list.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onToggleActive={handleToggleActive}
              onBalanceChange={handleBalanceChange}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-5 pb-8">
      {loading ? (
        <p className="text-center py-12 text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <>
          {renderSection('자산', ASSET_SECTION)}
          {renderSection('부채', LIABILITY_SECTION)}
          {assets.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">등록된 자산이 없습니다.</p>
          )}
        </>
      )}
      <Link
        href="/settings/assets/new"
        className="block w-full py-4 border-2 border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 text-center hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + 자산 추가
      </Link>
    </main>
  );
}
