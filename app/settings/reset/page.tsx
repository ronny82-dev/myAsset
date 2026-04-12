'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

const CONFIRM_KEYWORD = '초기화';

export default function ResetPage() {
  const router = useRouter();
  const { group, currentUser } = useGroup();
  const [step, setStep] = useState<1 | 2>(1);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleReset = async () => {
    if (input !== CONFIRM_KEYWORD) return;
    setError('');
    setLoading(true);
    try {
      // 그룹이 있으면 그룹 전체, 없으면 개인 거래내역만 삭제
      let query = supabase.from('transactions').delete();
      if (group?.id) {
        query = query.eq('group_id', group.id);
      } else if (currentUser?.id) {
        query = query.eq('user_id', currentUser.id);
      } else {
        throw new Error('사용자 정보를 확인할 수 없습니다.');
      }
      const { error: delErr } = await query;
      if (delErr) throw delErr;
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? '초기화 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <main className="px-4 py-8 max-w-lg mx-auto flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">✓</div>
        <h2 className="text-lg font-bold text-gray-800">초기화 완료</h2>
        <p className="text-sm text-gray-500">모든 거래내역이 삭제되었습니다.</p>
        <button
          onClick={() => router.push('/settings')}
          className="mt-4 w-full py-3 bg-blue-600 text-white font-bold rounded-2xl"
        >
          설정으로 돌아가기
        </button>
      </main>
    );
  }

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-4">
      {/* 경고 안내 */}
      <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-4 space-y-2">
        <p className="text-sm font-bold text-red-600">⚠️ 주의</p>
        <ul className="text-xs text-red-500 space-y-1 list-disc list-inside">
          <li>
            {group ? `"${group.name}" 그룹의 모든 거래내역` : '내 모든 거래내역'}이 영구 삭제됩니다.
          </li>
          <li>삭제된 데이터는 복구할 수 없습니다.</li>
          <li>카테고리, 자산, 카드 정보는 유지됩니다.</li>
        </ul>
      </div>

      {step === 1 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm text-gray-700">
            거래내역을 초기화하면 지금까지 기록한 모든 수입·지출 내역이 삭제됩니다.
            정말로 초기화하시겠습니까?
          </p>
          <button
            onClick={() => setStep(2)}
            className="w-full py-3 text-sm font-bold text-red-500 border-2 border-red-300 rounded-2xl hover:bg-red-50 transition-colors"
          >
            거래내역 초기화 진행
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm text-gray-700">
            확인을 위해 아래에 <strong className="text-red-500">"{CONFIRM_KEYWORD}"</strong>를 입력하세요.
          </p>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={CONFIRM_KEYWORD}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleReset}
            disabled={input !== CONFIRM_KEYWORD || loading}
            className="w-full py-3 text-sm font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 rounded-2xl transition-colors"
          >
            {loading ? '초기화 중...' : '확인 및 초기화'}
          </button>
          <button
            onClick={() => { setStep(1); setInput(''); }}
            className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
          >
            취소
          </button>
        </div>
      )}
    </main>
  );
}
