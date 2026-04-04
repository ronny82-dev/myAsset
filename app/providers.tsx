'use client';
import { GroupProvider } from '@/context/GroupContext';
import { Toaster } from 'react-hot-toast'; // Toaster import

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GroupProvider>
      {children}
      <Toaster /> {/* Toaster 컴포넌트 추가 */}
    </GroupProvider>
  );
}
