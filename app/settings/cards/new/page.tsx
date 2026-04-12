'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import CardForm, { type CardFormValues } from '@/components/settings/CardForm';

export default function NewCardPage() {
  const router = useRouter();
  const { group, currentUser } = useGroup();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (values: CardFormValues) => {
    setError('');
    setSaving(true);
    try {
      if (!currentUser) throw new Error('로그인이 필요합니다.');
      const { data: asset, error: aErr } = await supabase
        .from('assets')
        .insert({
          name: values.name,
          type: 'CARD',
          balance: 0,
          user_id: currentUser.id,
          group_id: group?.id ?? null,
          is_active: true,
        })
        .select()
        .single();
      if (aErr) throw aErr;

      const { error: cdErr } = await supabase.from('card_details').insert({
        asset_id: asset.id,
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

  return (
    <main className="px-4 py-4 max-w-lg mx-auto pb-8">
      {error && <p className="mb-4 text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      <CardForm onSave={handleSave} saving={saving} />
    </main>
  );
}
