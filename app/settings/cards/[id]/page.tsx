'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import CardForm, { type CardFormValues } from '@/components/settings/CardForm';

export default function EditCardPage() {
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

  const handleSave = async (values: CardFormValues) => {
    setError('');
    setSaving(true);
    try {
      const { error: aErr } = await supabase
        .from('assets')
        .update({ name: values.name })
        .eq('id', id);
      if (aErr) throw aErr;

      const { error: cdErr } = await supabase.from('card_details').upsert({
        asset_id: id,
        card_type: values.card_type,
        settlement_day: values.settlement_day,
        billing_start_offset: values.billing_start_offset,
        billing_end_offset: values.billing_end_offset,
        linked_asset_id: values.linked_asset_id,
      });
      if (cdErr) throw cdErr;

      router.push('/settings/cards');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('이 카드를 삭제할까요? 연결된 거래 내역은 유지됩니다.')) return;
    await supabase.from('assets').update({ is_active: false }).eq('id', id);
    router.push('/settings/cards');
  };

  if (loading) return <p className="text-center py-12 text-gray-400 text-sm">불러오는 중...</p>;

  return (
    <main className="px-4 py-4 max-w-lg mx-auto pb-8 space-y-4">
      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      <CardForm initial={initial} onSave={handleSave} saving={saving} />
      <button
        onClick={handleDelete}
        className="w-full py-3 text-sm text-red-500 border border-red-200 rounded-2xl hover:bg-red-50"
      >
        카드 비활성화
      </button>
    </main>
  );
}
