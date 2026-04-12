'use client';
import { usePathname } from 'next/navigation';
import BottomNav from './BottomNav';

const HIDDEN_PATHS = ['/login', '/onboarding'];

export default function BottomNavWrapper() {
  const pathname = usePathname();
  if (HIDDEN_PATHS.includes(pathname)) return null;
  return <BottomNav />;
}
