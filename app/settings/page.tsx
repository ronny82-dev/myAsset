'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useGroup } from '@/context/GroupContext';
import { supabase } from '@/utils/supabase';

function MenuItem({ href, label, desc }: { href: string; label: string; desc?: string }) {
  return (
    <Link href={href} className="flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition-colors">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <span className="text-gray-300">›</span>
    </Link>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { currentUser, group, members } = useGroup();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <main className="py-4 max-w-lg mx-auto space-y-3 pb-20">
      {/* 프로필 요약 */}
      <div className="bg-white mx-4 rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm border border-gray-100">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-xl">
          {currentUser?.nickname?.[0] ?? '?'}
        </div>
        <div>
          <p className="font-semibold text-gray-800">{currentUser?.nickname ?? '닉네임 없음'}</p>
          <p className="text-xs text-gray-400">{currentUser?.email}</p>
          {group && <p className="text-xs text-blue-500 mt-0.5">{group.name} · {members.length}명</p>}
        </div>
      </div>

      {/* 메뉴 그룹 */}
      <div className="bg-white mx-4 rounded-2xl overflow-hidden shadow-sm border border-gray-100 divide-y divide-gray-50">
        <MenuItem href="/settings/profile" label="프로필 & 그룹" desc="닉네임 수정, 커플 초대코드" />
        <MenuItem href="/settings/categories" label="카테고리 관리" desc="지출·수입 카테고리 추가/수정" />
        <MenuItem href="/settings/assets" label="자산 관리" desc="현금·은행계좌·투자·부채 등록" />
        <MenuItem href="/settings/cards" label="카드 관리" desc="신용카드·체크카드 등록 및 결제일 설정" />
      </div>

      {/* 데이터 관리 */}
      <div className="bg-white mx-4 rounded-2xl overflow-hidden shadow-sm border border-gray-100 divide-y divide-gray-50">
        <MenuItem href="/settings/bulk-entry" label="일괄 입력" desc="여러 거래내역을 한 번에 입력 (PC 전용)" />
        <MenuItem href="/settings/reset" label="거래내역 초기화" desc="모든 거래내역을 삭제합니다" />
      </div>

      {/* 로그아웃 */}
      <div className="bg-white mx-4 rounded-2xl overflow-hidden shadow-sm border border-gray-100">
        <button
          onClick={handleLogout}
          className="w-full text-left px-4 py-4 text-sm text-red-500 hover:bg-red-50 transition-colors"
        >
          로그아웃
        </button>
      </div>
    </main>
  );
}
