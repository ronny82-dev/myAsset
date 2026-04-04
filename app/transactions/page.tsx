'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import TransactionList from '@/components/TransactionList';
import { supabase } from '@/utils/supabase';

export default function TransactionsPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }

      const { data } = await supabase
        .from('users')
        .select('nickname')
        .eq('id', user.id)
        .single();

      if (data?.nickname) setNickname(data.nickname);
      setAuthChecked(true);
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 네비게이션 */}
      <nav className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex gap-1">
          <Link href="/" className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-50 transition-colors">
            지출 기록
          </Link>
          <span className="px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 rounded-lg">내역 조회</span>
        </div>
        <div className="flex items-center gap-3">
          {nickname && <span className="text-sm text-gray-500">{nickname}</span>}
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-600">로그아웃</button>
        </div>
      </nav>

      <main className="max-w-lg mx-auto py-8 px-4">
        <TransactionList />
      </main>
    </div>
  );
}
