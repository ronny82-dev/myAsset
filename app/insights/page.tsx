'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

const CACHE_KEY = 'ai_insight_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

export default function InsightsPage() {
  const router = useRouter();
  const { group } = useGroup();
  const [insight, setInsight] = useState('');
  const [loading, setLoading] = useState(false);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login');
    });

    // 캐시 확인
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { text, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        setInsight(text);
        setCachedAt(new Date(timestamp));
      }
    }
  }, []);

  const fetchInsight = async () => {
    setLoading(true);
    setInsight('');
    try {
      const res = await fetch('/api/insights', { method: 'POST' });
      const { insight: text, error } = await res.json();
      if (error) throw new Error(error);
      setInsight(text);
      const now = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify({ text, timestamp: now }));
      setCachedAt(new Date(now));
    } catch (err: any) {
      setInsight('분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="font-bold text-gray-800">AI 소비 분석</h1>
        {group && <p className="text-xs text-gray-400 mt-0.5">{group.name} · 최근 3개월</p>}
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto space-y-4">
        {/* 분석 요청 버튼 */}
        <button
          onClick={fetchInsight}
          disabled={loading}
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-200 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? '분석 중...' : '✨ AI 분석 시작하기'}
        </button>

        {cachedAt && !loading && (
          <p className="text-center text-xs text-gray-400">
            마지막 분석: {cachedAt.toLocaleDateString('ko-KR')} {cachedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}

        {/* 로딩 상태 */}
        {loading && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3">
            <div className="text-4xl animate-pulse">🤖</div>
            <p className="text-gray-500 text-sm">AI가 최근 3개월 지출을 분석하고 있습니다...</p>
          </div>
        )}

        {/* 분석 결과 */}
        {insight && !loading && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🤖</span>
              <h2 className="font-semibold text-gray-800">AI 리포트</h2>
            </div>
            <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {insight}
            </div>
          </div>
        )}

        {/* 안내 */}
        {!insight && !loading && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-3">
            <div className="text-5xl">📊</div>
            <h2 className="font-semibold text-gray-800">소비 패턴 AI 분석</h2>
            <p className="text-sm text-gray-400">
              최근 3개월 지출 데이터를 AI가 분석하여<br/>
              카테고리별 과소비 진단과 절약 팁을 제공합니다.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
