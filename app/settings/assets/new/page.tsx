'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import AssetForm, { type AssetFormValues } from '@/components/settings/AssetForm';

export default function NewAssetPage() {
  const router = useRouter();
  const { group, currentUser } = useGroup();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (values: AssetFormValues) => {
    setError('');
    setSaving(true);
    try {
      if (!currentUser) throw new Error('로그인이 필요합니다.');

      // 동일 이름 중복 확인
      const { data: existing } = await supabase
        .from('assets')
        .select('id')
        .eq('name', values.name.trim())
        .eq('group_id', group?.id ?? null)
        .limit(1)
        .maybeSingle();
      if (existing) throw new Error(`'${values.name.trim()}' 이름의 자산이 이미 존재합니다.`);

      const { error: aErr } = await supabase.from('assets').insert({
        name: values.name,
        type: values.type,
        initial_balance: values.initial_balance,
        balance: values.initial_balance,
        user_id: currentUser.id,
        group_id: group?.id ?? null,
        is_active: true,
      });
      if (aErr) throw aErr;
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
