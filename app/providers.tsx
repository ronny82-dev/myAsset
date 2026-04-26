'use client';
import { GroupProvider } from '@/context/GroupContext';
import { Toaster } from 'react-hot-toast';
import BiometricLock from '@/components/BiometricLock';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GroupProvider>
      <BiometricLock>
        {children}
      </BiometricLock>
      <Toaster />
    </GroupProvider>
  );
}
