'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: '기록', icon: '✏️' },
  { href: '/transactions', label: '내역', icon: '📋' },
  { href: '/dashboard', label: '대시보드', icon: '📊' },
  { href: '/settlement', label: '정산', icon: '💳' },
  { href: '/insights', label: 'AI 분석', icon: '✨', disabled: true },
  { href: '/settings', label: '설정', icon: '⚙️' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 safe-area-pb z-50">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon, disabled }) => {
          const active = pathname === href;
          if (disabled) {
            return (
              <button
                key={href}
                type="button"
                onClick={() => alert('아직 준비중입니다.')}
                className="flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-gray-300"
              >
                <span className="text-xl leading-none">{icon}</span>
                <span className="text-xs font-medium">{label}</span>
              </button>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors ${
                active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span className={`text-xs font-medium ${active ? 'text-blue-600' : ''}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
