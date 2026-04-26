'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useGroup } from '@/context/GroupContext';
import { supabase } from '@/utils/supabase';
import {
  isWebAuthnSupported,
  isBiometricEnabled,
  registerBiometric,
  disableBiometric,
} from '@/utils/webauthn';

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
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  useEffect(() => {
    setBiometricSupported(isWebAuthnSupported());
    setBiometricEnabled(isBiometricEnabled());
  }, []);

  const handleBiometricToggle = async () => {
    if (biometricEnabled) {
      disableBiometric();
      setBiometricEnabled(false);
      return;
    }
    setBiometricLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await registerBiometric(user.id);
      setBiometricEnabled(true);
    } catch {
      alert('지문 인증 등록에 실패했습니다. 기기가 지문 인식을 지원하는지 확인해주세요.');
    } finally {
      setBiometricLoading(false);
    }
  };

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

      {/* 보안 */}
      {biometricSupported && (
        <div className="bg-white mx-4 rounded-2xl overflow-hidden shadow-sm border border-gray-100">
          <button
            onClick={handleBiometricToggle}
            disabled={biometricLoading}
            className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <div>
              <p className="text-sm font-medium text-gray-800 text-left">지문 인증</p>
              <p className="text-xs text-gray-400 mt-0.5">앱 열 때 지문으로 잠금 해제</p>
            </div>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${biometricEnabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${biometricEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
          </button>
        </div>
      )}

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
