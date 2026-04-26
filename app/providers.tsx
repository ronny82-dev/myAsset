'use client';
import { GroupProvider } from '@/context/GroupContext';
import { Toaster } from 'react-hot-toast';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GroupProvider>
      {children}
      <Toaster />
    </GroupProvider>
  );
}
