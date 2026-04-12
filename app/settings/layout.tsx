'use client';
import { useRouter, usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/settings': '설정',
  '/settings/profile': '프로필 & 그룹',
  '/settings/categories': '카테고리 관리',
  '/settings/assets': '자산 관리',
  '/settings/assets/new': '자산 추가',
  '/settings/cards': '카드 관리',
  '/settings/cards/new': '카드 추가',
  '/settings/bulk-entry': '일괄 입력',
  '/settings/reset': '거래내역 초기화',
};

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/settings/assets/')) return '자산 편집';
  if (pathname.startsWith('/settings/cards/')) return '카드 편집';
  return '설정';
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = pathname === '/settings';
  const title = getTitle(pathname);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        {!isRoot && (
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 p-1 -ml-1">
            ←
          </button>
        )}
        <h1 className="font-bold text-gray-800">{title}</h1>
      </header>
      <div className="pb-16">
        {children}
      </div>
    </div>
  );
}
