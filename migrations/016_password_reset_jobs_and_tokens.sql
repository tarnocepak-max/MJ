-- =============================================================================
-- MORAJAWS MIGRATION 016: MASS PASSWORD RESET JOBS & SINGLE-USE RESET TOKENS
-- Description: Non-destructive schema additions for enterprise batch password
--              resets, single-use expiring SHA-256 reset tokens, and password
--              history reuse prevention.
-- =============================================================================

BEGIN;

-- 1. Non-destructively extend public.users with single-use reset token & history columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS reset_token_hash text,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reset_token_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS reset_token_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_history_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
  ON public.users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_must_change_password
  ON public.users (must_change_password)
  WHERE must_change_password = true;

-- 2. Mass / Batch Password Reset Job Header Table
CREATE TABLE IF NOT EXISTS public.password_reset_jobs (
  id text PRIMARY KEY,
  idempotency_key text UNIQUE,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_by_role text NOT NULL,
  reset_mode text NOT NULL DEFAULT 'force_change_with_token',
  target_scope text NOT NULL DEFAULT 'all_active',
  role_filter text,
  exclude_self boolean NOT NULL DEFAULT true,
  invalidate_sessions boolean NOT NULL DEFAULT true,
  token_ttl_hours integer NOT NULL DEFAULT 24,
  batch_size integer NOT NULL DEFAULT 5,
  reason text,
  status text NOT NULL DEFAULT 'queued',
  total_targets integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  processing_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  must_change_password_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_jobs_status
  ON public.password_reset_jobs (status, created_at DESC);

-- 3. Mass Password Reset Job Item Tracking Table (never stores plaintext secrets)
CREATE TABLE IF NOT EXISTS public.password_reset_job_items (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES public.password_reset_jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  username text NOT NULL,
  user_name text,
  user_role text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  must_change_password boolean NOT NULL DEFAULT false,
  sessions_revoked boolean NOT NULL DEFAULT false,
  reset_token_expires_at timestamptz,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  rollback_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_job_items_job_status
  ON public.password_reset_job_items (job_id, status);

COMMENT ON TABLE public.password_reset_jobs IS 'Audit-safe batch password reset orchestration jobs (zero plaintext passwords stored)';
COMMENT ON TABLE public.password_reset_job_items IS 'Per-user batch password reset execution status without plaintext credentials';

COMMIT;
