'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

type Step = 'choice' | 'create' | 'join';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateCode(): string {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default function OnboardingPage() {
  const router = useRouter();
  const { refreshGroup } = useGroup();
  const [step, setStep] = useState<Step>('choice');
  const [groupName, setGroupName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      // 유저 row 확인 (트리거 미실행 케이스 방어)
      await supabase.from('users').upsert({ id: user.id, email: user.email }, { onConflict: 'id' });

      // 그룹 생성
      const { data: group, error: gErr } = await supabase
        .from('groups')
        .insert({ name: groupName })
        .select()
        .single();
      if (gErr) throw gErr;

      // 그룹 멤버 등록
      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id });
      if (mErr) throw mErr;

      // 초대코드 생성
      const code = generateCode();
      const { error: iErr } = await supabase
        .from('group_invitations')
        .insert({ group_id: group.id, code, created_by: user.id });
      if (iErr) throw iErr;

      setGeneratedCode(code);
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');

      // 초대코드 조회
      const { data: inv, error: iErr } = await supabase
        .from('group_invitations')
        .select('id, group_id, expires_at, used_at')
        .eq('code', inviteCode.toUpperCase())
        .single();
      if (iErr || !inv) throw new Error('유효하지 않은 초대코드입니다.');
      if (inv.used_at) throw new Error('이미 사용된 초대코드입니다.');
      if (new Date(inv.expires_at) < new Date()) throw new Error('만료된 초대코드입니다.');

      // 유저 row 확인
      await supabase.from('users').upsert({ id: user.id, email: user.email }, { onConflict: 'id' });

      // 그룹 참여
      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: inv.group_id, user_id: user.id });
      if (mErr) throw mErr;

      // 초대코드 사용 처리
      await supabase
        .from('group_invitations')
        .update({ used_at: new Date().toISOString(), used_by: user.id })
        .eq('id', inv.id);

      await refreshGroup();
      router.push('/');
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDone = async () => {
    await refreshGroup();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">

        {/* 초기 선택 */}
        {step === 'choice' && (
          <>
            <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">커플 연결</h1>
            <p className="text-center text-gray-400 text-sm mb-8">파트너와 함께 가계부를 시작하세요</p>
            <div className="space-y-3">
              <button
                onClick={() => setStep('create')}
                className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-colors"
              >
                새 그룹 만들기
              </button>
              <button
                onClick={() => setStep('join')}
                className="w-full py-4 bg-white text-blue-600 font-bold rounded-2xl border-2 border-blue-600 hover:bg-blue-50 transition-colors"
              >
                초대코드로 참여하기
              </button>
            </div>
          </>
        )}

        {/* 그룹 생성 */}
        {step === 'create' && !generatedCode && (
          <>
            <button onClick={() => setStep('choice')} className="text-sm text-gray-400 mb-4">← 뒤로</button>
            <h2 className="text-xl font-bold text-gray-800 mb-6">그룹 이름 설정</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <input
                type="text"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="예: 민준♥지수 가계부"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? '생성 중...' : '그룹 만들기'}
              </button>
            </form>
          </>
        )}

        {/* 초대코드 생성 완료 */}
        {step === 'create' && generatedCode && (
          <>
            <h2 className="text-xl font-bold text-gray-800 mb-2">그룹 생성 완료!</h2>
            <p className="text-gray-400 text-sm mb-6">아래 초대코드를 파트너에게 공유하세요 (7일 유효)</p>
            <div className="bg-blue-50 rounded-2xl p-6 text-center mb-6">
              <p className="text-sm text-blue-400 mb-2">초대코드</p>
              <p className="text-4xl font-bold tracking-widest text-blue-600">{generatedCode}</p>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(generatedCode); }}
              className="w-full py-3 border-2 border-blue-600 text-blue-600 font-bold rounded-xl hover:bg-blue-50 mb-3"
            >
              코드 복사
            </button>
            <button
              onClick={handleDone}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700"
            >
              시작하기
            </button>
          </>
        )}

        {/* 초대코드로 참여 */}
        {step === 'join' && (
          <>
            <button onClick={() => setStep('choice')} className="text-sm text-gray-400 mb-4">← 뒤로</button>
            <h2 className="text-xl font-bold text-gray-800 mb-6">초대코드 입력</h2>
            <form onSubmit={handleJoin} className="space-y-4">
              <input
                type="text"
                required
                maxLength={6}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="6자리 코드 입력"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl font-bold tracking-widest uppercase"
              />
              {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? '참여 중...' : '참여하기'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
