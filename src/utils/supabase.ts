import { createBrowserClient } from '@supabase/auth-helpers-nextjs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabase.ts] NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.\n' +
    '.env.local 파일에 Supabase 프로젝트의 URL과 Anon Key를 추가해주세요.'
  );
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
