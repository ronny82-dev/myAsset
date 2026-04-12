-- ============================================================
-- RLS (Row Level Security) 현황 점검 및 설정 스크립트
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. 현재 RLS 활성화 상태 조회
-- ──────────────────────────────────────────────────────────────
SELECT
  t.schemaname,
  t.tablename,
  t.rowsecurity        AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
WHERE t.schemaname = 'public'
ORDER BY t.tablename;

-- ──────────────────────────────────────────────────────────────
-- 2. 현재 정의된 RLS 정책 목록 조회
-- ──────────────────────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================
-- 3. RLS 활성화 (비활성화된 테이블에 대해 실행)
-- ============================================================
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_details       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_monthly_balances ENABLE ROW LEVEL SECURITY;
-- settlements 테이블이 존재하는 경우에만 아래 주석 해제 후 실행
-- ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. RLS 정책 설정
--    내 그룹(group_id) 소속 데이터만 읽기/쓰기 허용
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 헬퍼 함수: 현재 사용자의 group_id 목록 반환
-- SECURITY DEFINER로 RLS를 우회해 group_members 무한재귀 방지
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
$$;

-- ────────────────────────────────
-- users 테이블: 본인 row만 접근
-- ────────────────────────────────
DROP POLICY IF EXISTS "users: 본인만 조회" ON public.users;
CREATE POLICY "users: 본인만 조회"
  ON public.users FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "users: 본인만 수정" ON public.users;
CREATE POLICY "users: 본인만 수정"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 같은 그룹 멤버 닉네임도 볼 수 있어야 하므로 추가
DROP POLICY IF EXISTS "users: 같은 그룹 멤버 조회" ON public.users;
CREATE POLICY "users: 같은 그룹 멤버 조회"
  ON public.users FOR SELECT
  USING (
    id IN (
      SELECT gm.user_id FROM public.group_members gm
      WHERE gm.group_id IN (
        SELECT public.my_group_ids()
      )
    )
  );

-- ────────────────────────────────
-- groups 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "groups: 내 그룹만 조회" ON public.groups;
CREATE POLICY "groups: 내 그룹만 조회"
  ON public.groups FOR SELECT
  USING (
    id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "groups: 인증된 사용자 생성" ON public.groups;
CREATE POLICY "groups: 인증된 사용자 생성"
  ON public.groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ────────────────────────────────
-- group_members 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "group_members: 내 그룹 멤버 조회" ON public.group_members;
CREATE POLICY "group_members: 내 그룹 멤버 조회"
  ON public.group_members FOR SELECT
  USING (
    -- 자기 자신의 멤버십 row만 직접 조건 체크 (서브쿼리/함수 참조 없음 → 재귀 원천 차단)
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "group_members: 본인 삽입" ON public.group_members;
CREATE POLICY "group_members: 본인 삽입"
  ON public.group_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────
-- group_invitations 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "group_invitations: 내 그룹 초대코드 조회" ON public.group_invitations;
CREATE POLICY "group_invitations: 내 그룹 초대코드 조회"
  ON public.group_invitations FOR SELECT
  USING (
    -- 코드 입력 시 모든 인증된 사용자가 조회 필요 (그룹 참여 전)
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "group_invitations: 내 그룹에만 생성" ON public.group_invitations;
CREATE POLICY "group_invitations: 내 그룹에만 생성"
  ON public.group_invitations FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "group_invitations: 사용 처리(update)" ON public.group_invitations;
CREATE POLICY "group_invitations: 사용 처리(update)"
  ON public.group_invitations FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ────────────────────────────────
-- assets 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "assets: 내 그룹만 조회" ON public.assets;
CREATE POLICY "assets: 내 그룹만 조회"
  ON public.assets FOR SELECT
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "assets: 내 그룹에만 생성" ON public.assets;
CREATE POLICY "assets: 내 그룹에만 생성"
  ON public.assets FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "assets: 내 그룹만 수정" ON public.assets;
CREATE POLICY "assets: 내 그룹만 수정"
  ON public.assets FOR UPDATE
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "assets: 내 그룹만 삭제" ON public.assets;
CREATE POLICY "assets: 내 그룹만 삭제"
  ON public.assets FOR DELETE
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

-- ────────────────────────────────
-- card_details 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "card_details: 내 그룹 자산의 카드 상세만 접근" ON public.card_details;
CREATE POLICY "card_details: 내 그룹 자산의 카드 상세만 접근"
  ON public.card_details FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM public.assets
      WHERE group_id IN (
        SELECT public.my_group_ids()
      )
    )
  )
  WITH CHECK (
    asset_id IN (
      SELECT id FROM public.assets
      WHERE group_id IN (
        SELECT public.my_group_ids()
      )
    )
  );

-- ────────────────────────────────
-- categories 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "categories: 내 그룹 또는 시스템 카테고리 조회" ON public.categories;
CREATE POLICY "categories: 내 그룹 또는 시스템 카테고리 조회"
  ON public.categories FOR SELECT
  USING (
    group_id IS NULL  -- 시스템 공통 카테고리
    OR group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "categories: 내 그룹에만 생성" ON public.categories;
CREATE POLICY "categories: 내 그룹에만 생성"
  ON public.categories FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "categories: 내 그룹만 수정/삭제" ON public.categories;
CREATE POLICY "categories: 내 그룹만 수정/삭제"
  ON public.categories FOR UPDATE
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

-- ────────────────────────────────
-- transactions 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "transactions: 내 그룹만 조회" ON public.transactions;
CREATE POLICY "transactions: 내 그룹만 조회"
  ON public.transactions FOR SELECT
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "transactions: 내 그룹에만 생성" ON public.transactions;
CREATE POLICY "transactions: 내 그룹에만 생성"
  ON public.transactions FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "transactions: 내 그룹만 수정" ON public.transactions;
CREATE POLICY "transactions: 내 그룹만 수정"
  ON public.transactions FOR UPDATE
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

DROP POLICY IF EXISTS "transactions: 내 그룹만 삭제" ON public.transactions;
CREATE POLICY "transactions: 내 그룹만 삭제"
  ON public.transactions FOR DELETE
  USING (
    group_id IN (
      SELECT public.my_group_ids()
    )
  );

-- ────────────────────────────────
-- asset_monthly_balances 테이블
-- ────────────────────────────────
DROP POLICY IF EXISTS "asset_monthly_balances: 내 그룹 자산만 접근" ON public.asset_monthly_balances;
CREATE POLICY "asset_monthly_balances: 내 그룹 자산만 접근"
  ON public.asset_monthly_balances FOR ALL
  USING (
    asset_id IN (
      SELECT id FROM public.assets
      WHERE group_id IN (
        SELECT public.my_group_ids()
      )
    )
  )
  WITH CHECK (
    asset_id IN (
      SELECT id FROM public.assets
      WHERE group_id IN (
        SELECT public.my_group_ids()
      )
    )
  );

-- ────────────────────────────────
-- settlements 테이블 (테이블이 존재하는 경우에만 주석 해제 후 실행)
-- ────────────────────────────────
-- DROP POLICY IF EXISTS "settlements: 내 그룹만 접근" ON public.settlements;
-- CREATE POLICY "settlements: 내 그룹만 접근"
--   ON public.settlements FOR ALL
--   USING (
--     group_id IN (
--       SELECT public.my_group_ids()
--     )
--   )
--   WITH CHECK (
--     group_id IN (
--       SELECT public.my_group_ids()
--     )
--   );

-- ============================================================
-- 5. 적용 후 재확인
-- ============================================================
SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
