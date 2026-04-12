-- ============================================================
-- 전체 테이블 백업 스크립트
-- Supabase SQL Editor에서 실행하세요.
-- 백업 테이블명: {테이블명}_backup_{YYYYMMDD}
-- ============================================================
-- ※ 주의: 실행 전 아래 날짜 suffix를 오늘 날짜로 변경하세요.
--   예) 20260412  →  20260501
-- ============================================================

DO $$
DECLARE
  suffix text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD');
BEGIN
  RAISE NOTICE '백업 시작: % (suffix: %)', now(), suffix;
END $$;

-- ────────────────────────────────
-- users
-- ────────────────────────────────
DROP TABLE IF EXISTS public.users_backup_20260412;
CREATE TABLE public.users_backup_20260412 AS
  SELECT * FROM public.users;

-- ────────────────────────────────
-- user_settings
-- ────────────────────────────────
DROP TABLE IF EXISTS public.user_settings_backup_20260412;
CREATE TABLE public.user_settings_backup_20260412 AS
  SELECT * FROM public.user_settings;

-- ────────────────────────────────
-- groups
-- ────────────────────────────────
DROP TABLE IF EXISTS public.groups_backup_20260412;
CREATE TABLE public.groups_backup_20260412 AS
  SELECT * FROM public.groups;

-- ────────────────────────────────
-- group_members
-- ────────────────────────────────
DROP TABLE IF EXISTS public.group_members_backup_20260412;
CREATE TABLE public.group_members_backup_20260412 AS
  SELECT * FROM public.group_members;

-- ────────────────────────────────
-- group_invitations
-- ────────────────────────────────
DROP TABLE IF EXISTS public.group_invitations_backup_20260412;
CREATE TABLE public.group_invitations_backup_20260412 AS
  SELECT * FROM public.group_invitations;

-- ────────────────────────────────
-- categories
-- ────────────────────────────────
DROP TABLE IF EXISTS public.categories_backup_20260412;
CREATE TABLE public.categories_backup_20260412 AS
  SELECT * FROM public.categories;

-- ────────────────────────────────
-- assets
-- ────────────────────────────────
DROP TABLE IF EXISTS public.assets_backup_20260412;
CREATE TABLE public.assets_backup_20260412 AS
  SELECT * FROM public.assets;

-- ────────────────────────────────
-- card_details
-- ────────────────────────────────
DROP TABLE IF EXISTS public.card_details_backup_20260412;
CREATE TABLE public.card_details_backup_20260412 AS
  SELECT * FROM public.card_details;

-- ────────────────────────────────
-- transactions
-- ────────────────────────────────
DROP TABLE IF EXISTS public.transactions_backup_20260412;
CREATE TABLE public.transactions_backup_20260412 AS
  SELECT * FROM public.transactions;

-- ────────────────────────────────
-- asset_monthly_balances
-- ────────────────────────────────
DROP TABLE IF EXISTS public.asset_monthly_balances_backup_20260412;
CREATE TABLE public.asset_monthly_balances_backup_20260412 AS
  SELECT * FROM public.asset_monthly_balances;

-- ============================================================
-- 백업 결과 확인
-- ============================================================
SELECT
  tablename                                          AS 백업테이블,
  (xpath('/row/cnt/text()',
    query_to_xml(format('SELECT COUNT(*) AS cnt FROM public.%I', tablename), false, true, ''))
  )[1]::text::int                                    AS 행수
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE '%_backup_20260412'
ORDER BY tablename;
