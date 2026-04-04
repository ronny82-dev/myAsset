'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import AssetForm from '@/components/settings/AssetForm';

export default function NewAssetPage() {
  const router = useRouter();
  const { group, currentUser } = useGroup();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      if (!currentUser) throw new Error('로그인이 필요합니다.');
      const { data: asset, error: aErr } = await supabase
        .from('assets')
        .insert({
          name: values.name,
          type: values.type,
          balance: values.type === 'CARD' ? 0 : values.balance,
          user_id: currentUser.id,
          group_id: group?.id ?? null,
          is_active: true,
        })
        .select()
        .single();
      if (aErr) throw aErr;

      if (values.type === 'CARD' && values.cardDetails) {
        const { error: cdErr } = await supabase.from('card_details').insert({
          asset_id: asset.id,
          ...values.cardDetails,
        });
        if (cdErr) throw cdErr;
      }
      router.push('/settings/assets');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="px-4 py-4 max-w-lg mx-auto pb-8">
      {error && <p className="mb-4 text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
      <AssetForm onSave={handleSave} saving={saving} />
    </main>
  );
}
