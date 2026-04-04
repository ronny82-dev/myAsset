'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExpenseForm from '@/components/ExpenseForm';
import toast from 'react-hot-toast'; // toast import
import type { Asset, Category, Member } from '@/components/ExpenseForm';
import { supabase } from '@/utils/supabase';

export default function Home() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [formKey, setFormKey] = useState(Date.now());
  const [nickname, setNickname] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      // 인증 정보 확인과 데이터베이스 조회를 병렬로 실행하여 초기 로딩 속도를 최적화합니다.
      const [authResult, assetsResult, categoriesResult, membersResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('assets').select('*, card_details!card_details_asset_id_fkey(settlement_day, billing_start_offset, billing_end_offset)').order('name'),
        supabase.from('categories').select('*').order('type').order('id'),
        supabase.from('users').select('id, nickname'),
      ]);

      const { data: { user } } = authResult;
      if (!user) { router.push('/login'); return; }

      if (assetsResult.error) throw assetsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (membersResult.error) throw membersResult.error;

      if (assetsResult.data) setAssets(assetsResult.data);
      if (categoriesResult.data) setCategories(categoriesResult.data);
      if (membersResult.data) setMembers(membersResult.data);

      const me = membersResult.data?.find((m) => m.id === user.id);
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
    payer?: Member;
    billingDate?: Date | null;
    transactedAt: string;
    description?: string;
  }) => {
    if (!data.selectedAsset || !data.selectedCategory || !data.payer) {
      toast.error('모든 입력 항목을 선택해주세요.');
      return;
    }

    const numericAmount = parseInt(data.amount.replace(/,/g, ''), 10);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast.error('유효한 금액을 입력해주세요.');
      return;
    }

    const now = new Date();
    const timeString = now.toISOString().split('T')[1];
    const transactedAtIso = `${data.transactedAt}T${timeString}`;

    const { error } = await supabase.from('transactions').insert([{
      type: data.type,
      amount: numericAmount,
      asset_id: data.selectedAsset.id,
      category_id: data.selectedCategory.id,
      user_id: data.payer.id,
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
      toast.success(data.type === 'EXPENSE' ? '지출 기록이 등록되었습니다!' : '수입 기록이 등록되었습니다!');
      fetchData();
      setFormKey(Date.now());
    }
  };

  const handleCategoryCreate = async (name: string, type: 'EXPENSE' | 'INCOME'): Promise<Category | null> => {
    const { data, error } = await supabase
      .from('categories')
      .insert({ name, type, is_visible: true, parent_id: null })
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
          members={members}
          onSubmit={handleSubmit}
          onCategoryCreate={handleCategoryCreate}
        />
      </main>
    </div>
  );
}
