'use client';
import { useEffect, useState } from 'react';
import ExpenseForm from '@/components/ExpenseForm';
import toast from 'react-hot-toast'; // toast import
import type { Asset, Category, Member } from '@/components/ExpenseForm';
import { supabase } from '@/utils/supabase';

export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [formKey, setFormKey] = useState(Date.now()); // 폼 초기화를 위한 key 상태

  const fetchData = async () => {
    setLoading(true);
    try {
      // 세 개의 테이블을 병렬로 불러와 속도 최적화
      const [assetsResult, categoriesResult, membersResult] = await Promise.all([
        supabase.from('assets').select('*, card_details(settlement_day)').order('name'),
        supabase.from('categories').select('*').order('id'),
        supabase.from('users').select('id, nickname')
      ]);

      // 각 요청의 에러를 개별적으로 확인하여 안정성 확보
      if (assetsResult.error) throw assetsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (membersResult.error) throw membersResult.error;

      // data가 null이 아닐 경우에만 상태 업데이트
      if (assetsResult.data) setAssets(assetsResult.data);
      if (categoriesResult.data) setCategories(categoriesResult.data);
      if (membersResult.data) setMembers(membersResult.data);

    } catch (error) {
      const errorDetails = (error as any)?.message || JSON.stringify(error);
      console.error('데이터 로딩 오류 상세:', errorDetails, error);
      toast.error(`초기 데이터를 불러오는 데 실패했습니다.\n사유: ${errorDetails}`); // 토스트 알림으로 변경
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // assets, expenses 테이블의 변경사항을 실시간으로 감지
    const channel = supabase.channel('realtime-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSubmit = async (data: {
    amount: string;
    selectedAsset?: Asset;
    selectedCategory?: Category;
    payer?: Member;
    billingDate?: Date | null;
    transactedAt: string;
    description?: string;
  }) => {
    if (!data.selectedAsset || !data.selectedCategory || !data.payer) {
      toast.error('모든 입력 항목을 선택해주세요.'); // 토스트 알림으로 변경
      return;
    }

    // 콤마(,) 제거 후 숫자로 치환
    const numericAmount = parseInt(data.amount.replace(/,/g, ''), 10);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast.error('유효한 지출 금액을 입력해주세요.'); // 토스트 알림으로 변경
      return;
    }

    // 선택한 날짜에 현재 시간(시/분/초)을 덧붙여 ISO 형식으로 변환합니다.
    const now = new Date();
    const timeString = now.toISOString().split('T')[1];
    const transactedAtIso = `${data.transactedAt}T${timeString}`;

    // 실제 Supabase 'expenses' 테이블에 데이터 저장
    const { error } = await supabase.from('transactions').insert([{
      type: 'EXPENSE',
      amount: numericAmount,
      asset_id: data.selectedAsset.id,
      category_id: data.selectedCategory.id,
      user_id: data.payer.id,
      transacted_at: transactedAtIso,
      expected_billing_at: data.billingDate ? data.billingDate.toISOString().split('T')[0] : null,
      description: data.description || null,
    }]);

    if (error) {
      console.error('DB 저장 실패:', error);
      toast.error('데이터 저장 중 오류가 발생했습니다.'); // 토스트 알림으로 변경
    } else {
      toast.success('지출 기록이 성공적으로 등록되었습니다!'); // 토스트 알림으로 변경
      // 데이터 재로딩 및 폼 초기화 (key 변경)
      fetchData();
      setFormKey(Date.now());
    }
  };

  const handleCategoryCreate = async (name: string, type: 'EXPENSE' | 'INCOME', parentId: string | number | null = null): Promise<Category | null> => {
    const { data, error } = await supabase
      .from('categories')
      .insert({ name, type, is_active: true, parent_id: parentId })
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">데이터를 불러오는 중입니다...</div>;
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <ExpenseForm 
        key={formKey}
        assets={assets} 
        categories={categories} 
        members={members} 
        onSubmit={handleSubmit}
        onCategoryCreate={handleCategoryCreate}
      />
    </main>
  );
}