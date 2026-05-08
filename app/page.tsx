'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExpenseForm from '@/components/ExpenseForm';
import toast from 'react-hot-toast'; // toast import
import type { Asset, Category } from '@/components/ExpenseForm';
import { supabase } from '@/utils/supabase';
import { invalidateFrom } from '@/utils/monthlyBalance';
import { useGroup } from '@/context/GroupContext';

export default function Home() {
  const router = useRouter();
  const { group } = useGroup();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [formKey, setFormKey] = useState(Date.now());
  const [nickname, setNickname] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 인증 정보 확인과 데이터베이스 조회를 병렬로 실행하여 초기 로딩 속도를 최적화합니다.
      const [authResult, assetsResult, categoriesResult, membersResult, usageResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('assets').select('*, card_details!card_details_asset_id_fkey(settlement_day, billing_start_offset, billing_end_offset)').order('name'),
        supabase.from('categories').select('*').order('type').order('id'),
        supabase.from('users').select('id, nickname'),
        supabase.from('transactions').select('asset_id').eq('is_deleted', false).not('asset_id', 'is', null).order('transacted_at', { ascending: false }).limit(100),
      ]);

      const { data: { user } } = authResult;
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      if (assetsResult.error) throw assetsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (membersResult.error) throw membersResult.error;

      if (assetsResult.data) {
        // 최근 100건 기준 자산 사용 빈도 집계 후 내림차순 정렬
        const usageCounts: Record<string, number> = {};
        for (const tx of usageResult.data ?? []) {
          if (tx.asset_id) usageCounts[tx.asset_id] = (usageCounts[tx.asset_id] ?? 0) + 1;
        }
        const sorted = [...assetsResult.data].sort((a, b) => (usageCounts[b.id] ?? 0) - (usageCounts[a.id] ?? 0));
        setAssets(sorted);
      }
      if (categoriesResult.data) setCategories(categoriesResult.data);

      const me = membersResult.data?.find((m: any) => m.id === user.id);
      if (me?.nickname) setNickname(me.nickname);
    } catch (error: any) {
      console.error('데이터 로딩 오류:', error.message);
      toast.error(`데이터 로딩 오류: ${error.message}`); // 토스트 알림으로 변경
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const channel = supabase.channel('realtime-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, fetchData)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, fetchData)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSubmit = async (data: {
    type: 'EXPENSE' | 'INCOME';
    amount: string;
    selectedAsset?: Asset;
    selectedCategory?: Category;
    billingDate?: Date | null;
    transactedAt: string;
    description?: string;
    transferTargetAsset?: Asset;
  }) => {
    if (!data.description?.trim()) {
      toast.error('적요를 입력해주세요.');
      return;
    }

    if (!data.selectedAsset || !data.selectedCategory) {
      toast.error('모든 입력 항목을 선택해주세요.');
      return;
    }

    const numericAmount = parseInt(data.amount.replace(/,/g, ''), 10);
    if (isNaN(numericAmount) || numericAmount === 0) {
      toast.error('유효한 금액을 입력해주세요.');
      return;
    }

    const now = new Date();
    const timeString = now.toISOString().split('T')[1];
    const transactedAtIso = `${data.transactedAt}T${timeString}`;

    // 이체/대체: 출금 EXPENSE + 입금 INCOME 쌍 생성
    if ((data.selectedCategory as any).is_system && data.transferTargetAsset) {
      const pairId = crypto.randomUUID();
      const base = {
        category_id: data.selectedCategory.id,
        user_id: userId,
        group_id: group?.id ?? null,
        transacted_at: transactedAtIso,
        description: data.description || null,
        amount: numericAmount,
        transfer_pair_id: pairId,
        is_deleted: false,
      };
      const { error } = await supabase.from('transactions').insert([
        { ...base, type: 'EXPENSE', asset_id: data.selectedAsset.id },
        { ...base, type: 'INCOME',  asset_id: data.transferTargetAsset.id },
      ]);
      if (error) {
        console.error('이체 저장 실패:', error);
        toast.error('이체 저장 중 오류가 발생했습니다.');
      } else {
        const yearMonth = transactedAtIso.slice(0, 7);
        await Promise.all([
          invalidateFrom(data.selectedAsset.id, yearMonth),
          invalidateFrom(data.transferTargetAsset.id, yearMonth),
        ]);
        toast.success(`${data.selectedAsset.name} → ${data.transferTargetAsset.name} 이체가 등록되었습니다.`);
        fetchData();
        setFormKey(Date.now());
      }
      return;
    }

    const { error } = await supabase.from('transactions').insert([{
      type: data.type,
      amount: numericAmount,
      asset_id: data.selectedAsset.id,
      category_id: data.selectedCategory.id,
      user_id: userId,
      group_id: group?.id ?? null,
      transacted_at: transactedAtIso,
      expected_billing_at: data.type === 'EXPENSE' && data.billingDate
        ? data.billingDate.toISOString().split('T')[0]
        : null,
      description: data.description || null,
    }]);

    if (error) {
      console.error('DB 저장 실패:', error);
      toast.error('데이터 저장 중 오류가 발생했습니다.');
    } else {
      await invalidateFrom(data.selectedAsset.id, transactedAtIso.slice(0, 7));
      toast.success(data.type === 'EXPENSE' ? '지출 기록이 등록되었습니다!' : '수입 기록이 등록되었습니다!');
      fetchData();
      setFormKey(Date.now());
    }
  };

  const handleCategoryCreate = async (name: string, type: 'EXPENSE' | 'INCOME', parentId?: string | number | null): Promise<Category | null> => {
    const { data, error } = await supabase
      .from('categories')
      .insert({ name, type, is_visible: true, parent_id: parentId ?? null })
      .select()
      .single();
    if (error || !data) {
      toast.error('카테고리 추가에 실패했습니다.');
      return null;
    }
    setCategories((prev) => [...prev, data as Category]);
    toast.success(`'${name}' 카테고리가 추가되었습니다.`);
    return data as Category;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-gray-800">지출 기록</h1>
        <div className="flex items-center gap-3">
          {nickname && <span className="text-sm text-gray-500">{nickname}</span>}
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-600">로그아웃</button>
        </div>
      </header>
      <main className="py-6 px-4">
        <ExpenseForm
          key={formKey}
          assets={assets}
          categories={categories}
          onSubmit={handleSubmit}
          onCategoryCreate={handleCategoryCreate}
        />
      </main>
    </div>
  );
}
