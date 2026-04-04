'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import AssetForm from '@/components/settings/AssetForm';

export default function EditAssetPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('assets')
      .select('*, card_details!card_details_asset_id_fkey(*)')
      .eq('id', id)
      .single()
      .then(({ data }) => { if (data) setInitial(data); setLoading(false); });
  }, [id]);

  const handleSave = async (values: {
    name: string;
    type: 'CASH' | 'BANK' | 'CARD' | 'INVESTMENT';
    balance: number;
    cardDetails?: {
      card_type: 'CREDIT' | 'CHECK';
      settlement_day: number;
      billing_start_offset: number;
      billing_end_offset: number;
      linked_asset_id: string | null;
    };
  }) => {
    setError('');
    setSaving(true);
    try {
      const { error: aErr } = await supabase
        .from('assets')
        .update({ name: values.name, balance: values.type === 'CARD' ? initial?.balance ?? 0 : values.balance })
        .eq('id', id);
      if (aErr) throw aErr;

      if (values.type === 'CARD' && values.cardDetails) {
        const { error: cdErr } = await supabase
          .from('card_details')
          .upsert({ asset_id: id, ...values.cardDetails });
        if (cdErr) throw cdErr;
      }
      router.push('/settings/assets');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('이 자산을 삭제할까요? 연결된 거래 내역은 유지됩니다.')) return;
    await supabase.from('assets').update({ is_active: false }).eq('id', id);
    router.push('/settings/assets');
  };

  if (loading) return <p className="text-center py-12 text-gray-400 text-sm">불러오는 중...</p>;

  return (
    <main className="px-4 py-4 max-w-lg mx-auto pb-8 space-y-4">
      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      <AssetForm
        initial={initial}
        onSave={handleSave}
        saving={saving}
      />
      <button
        onClick={handleDelete}
        className="w-full py-3 text-sm text-red-500 border border-red-200 rounded-2xl hover:bg-red-50"
      >
        자산 비활성화
      </button>
    </main>
  );
}
