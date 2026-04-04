'use client';
import { usePathname } from 'next/navigation';
import BottomNav from './BottomNav';

const HIDDEN_PATHS = ['/login', '/onboarding'];

export default function BottomNavWrapper() {
  const pathname = usePathname();
  // 로그인·온보딩·설정 하위 페이지에서는 숨김
  if (HIDDEN_PATHS.includes(pathname)) return null;
  if (pathname.startsWith('/settings/')) return null;
  return <BottomNav />;
}
