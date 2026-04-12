import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
}

/**
 * 요청 인증 확인 + 사용자의 group_id 조회
 * 인증 실패 시 { error: NextResponse } 반환
 * 성공 시 { userId, groupId } 반환
 */
export async function requireAuth(): Promise<
  | { error: NextResponse; userId?: never; groupId?: never }
  | { error?: never; userId: string; groupId: string | null }
> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }),
    };
  }

  const { data: member } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return { userId: user.id, groupId: member?.group_id ?? null };
}
