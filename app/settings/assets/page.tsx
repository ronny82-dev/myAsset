'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase';

interface Asset {
  id: string;
  name: string;
  type: 'CASH' | 'BANK' | 'CARD' | 'INVESTMENT';
  balance: number;
  is_active: boolean;
}

const TYPE_LABEL: Record<string, string> = { CASH: '현금', BANK: '은행', CARD: '카드', INVESTMENT: '투자' };
const TYPE_COLOR: Record<string, string> = {
  CASH: 'bg-green-100 text-green-700',
  BANK: 'bg-blue-100 text-blue-700',
  CARD: 'bg-red-100 text-red-600',
  INVESTMENT: 'bg-purple-100 text-purple-700',
};
const TYPE_ORDER = ['CASH', 'BANK', 'CARD', 'INVESTMENT'];

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssets = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('assets')
      .select('id, name, type, balance, is_active')
      .order('type')
      .order('name');
    if (data) setAssets(data as Asset[]);
    setLoading(false);
  };

  useEffect(() => { fetchAssets(); }, []);

  const toggleActive = async (asset: Asset) => {
    await supabase.from('assets').update({ is_active: !asset.is_active }).eq('id', asset.id);
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, is_active: !asset.is_active } : a));
  };

  const grouped = TYPE_ORDER.reduce<Record<string, Asset[]>>((acc, t) => {
    acc[t] = assets.filter((a) => a.type === t);
    return acc;
  }, {} as Record<string, Asset[]>);

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-4 pb-8">
      {loading ? (
        <p className="text-center py-12 text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        TYPE_ORDER.map((type) => {
          const list = grouped[type];
          if (list.length === 0) return null;
          return (
            <div key={type}>
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-1 mb-2">{TYPE_LABEL[type]}</h3>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                {list.map((asset) => (
                  <div key={asset.id} className={`flex items-center px-4 py-3 gap-3 ${!asset.is_active ? 'opacity-40' : ''}`}>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TYPE_COLOR[type]}`}>
                      {TYPE_LABEL[type]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{asset.name}</p>
                      <p className="text-xs text-gray-400">{asset.balance.toLocaleString('ko-KR')}원</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleActive(asset)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${asset.is_active ? 'bg-blue-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${asset.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <Link href={`/settings/assets/${asset.id}`} className="text-xs text-gray-400 hover:text-blue-500 px-1">
                        편집
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {!loading && assets.length === 0 && (
        <p className="text-center py-8 text-gray-400 text-sm">등록된 자산이 없습니다.</p>
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
