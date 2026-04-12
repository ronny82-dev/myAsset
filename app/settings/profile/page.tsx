'use client';
import { useState } from 'react';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateCode(): string {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default function ProfilePage() {
  const { currentUser, group, members, refreshGroup } = useGroup();
  const [nickname, setNickname] = useState(currentUser?.nickname ?? '');
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState('');

  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveNickname = async () => {
    if (!currentUser) return;
    setNicknameLoading(true);
    setNicknameMsg('');
    const { error } = await supabase
      .from('users')
      .update({ nickname })
      .eq('id', currentUser.id);
    if (error) {
      setNicknameMsg('저장 실패: ' + error.message);
    } else {
      setNicknameMsg('저장되었습니다.');
      await refreshGroup();
    }
    setNicknameLoading(false);
  };

  const generateInviteCode = async () => {
    if (!group || !currentUser) return;
    setInviteLoading(true);
    const code = generateCode();
    const { error } = await supabase.from('group_invitations').insert({
      group_id: group.id,
      code,
      created_by: currentUser.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!error) setInviteCode(code);
    setInviteLoading(false);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="px-4 py-6 max-w-lg mx-auto space-y-4">
      {/* 닉네임 수정 */}
      <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-500 mb-4">내 정보</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">이메일</label>
            <p className="text-sm text-gray-700">{currentUser?.email}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">닉네임</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={saveNickname}
                disabled={nicknameLoading}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                저장
              </button>
            </div>
            {nicknameMsg && (
              <p className={`text-xs mt-1 ${nicknameMsg.includes('실패') ? 'text-red-500' : 'text-green-600'}`}>
                {nicknameMsg}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 그룹 정보 */}
      {group ? (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">커플 그룹</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">그룹 이름</label>
              <p className="text-sm font-medium text-gray-800">{group.name}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">멤버</label>
              <div className="flex gap-2 flex-wrap">
                {members.map((m) => (
                  <span key={m.id} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">
                    {m.nickname || m.email}
                    {m.id === currentUser?.id && ' (나)'}
                  </span>
                ))}
              </div>
            </div>

            {/* 초대코드 */}
            <div>
              <label className="text-xs text-gray-400 mb-2 block">파트너 초대</label>
              {inviteCode ? (
                <div className="bg-blue-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold tracking-widest text-blue-600 mb-2">{inviteCode}</p>
                  <p className="text-xs text-blue-400 mb-3">7일간 유효합니다</p>
                  <button
                    onClick={copyCode}
                    className="w-full py-2 border-2 border-blue-500 text-blue-600 text-sm font-medium rounded-xl hover:bg-blue-100"
                  >
                    {copied ? '복사됨 ✓' : '코드 복사'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={generateInviteCode}
                  disabled={inviteLoading}
                  className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 text-sm rounded-xl hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                >
                  {inviteLoading ? '생성 중...' : '+ 초대코드 생성'}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="bg-yellow-50 rounded-2xl p-4 text-sm text-yellow-700 border border-yellow-200">
          아직 그룹에 참여하지 않았습니다.{' '}
          <a href="/onboarding" className="font-semibold underline">그룹 만들기 →</a>
        </div>
      )}
    </main>
  );
}
