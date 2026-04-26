'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  isWebAuthnSupported,
  isBiometricEnabled,
  authenticateWithBiometric,
  markSessionUnlocked,
  isSessionUnlocked,
} from '@/utils/webauthn';

const AUTH_PAGES = ['/login', '/onboarding'];

export default function BiometricLock({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAuthPage = AUTH_PAGES.includes(pathname);

  const unlock = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ok = await authenticateWithBiometric();
      if (ok) {
        markSessionUnlocked();
        setLocked(false);
      } else {
        setError('인증에 실패했습니다. 다시 시도해주세요.');
      }
    } catch {
      setError('지문 인증을 사용할 수 없습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthPage) {
      setLocked(false);
      setReady(true);
      return;
    }

    if (!isWebAuthnSupported() || !isBiometricEnabled() || isSessionUnlocked()) {
      setLocked(false);
      setReady(true);
      return;
    }

    setLocked(true);
    setReady(true);
    // 잠금 화면 표시 후 자동으로 지문 인증 팝업 실행
    unlock();
  }, [isAuthPage, unlock]);

  if (!ready) return null;

  if (locked) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6 px-6">
        <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-10 w-full max-w-xs text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v-3m0 0a3 3 0 10-3 3m3-3a3 3 0 013 3m-3 6a6 6 0 100-12 6 6 0 000 12z" />
            </svg>
          </div>

          <h1 className="text-lg font-bold text-gray-800 mb-1">커플 가계부</h1>
          <p className="text-sm text-gray-400 mb-6">지문 인증으로 잠금을 해제하세요</p>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 mb-4">{error}</p>
          )}

          <button
            onClick={unlock}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v2m-2-2v2m-4 0h8m-8 0H8a2 2 0 00-2 2v4a2 2 0 002 2h8a2 2 0 002-2v-4a2 2 0 00-2-2m-4 0V9a4 4 0 118 0v2" />
              </svg>
            )}
            {loading ? '인증 중...' : '지문 인증'}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
