-- ==============================================================================
-- MORAJAWS — AUTOMATIC WO EXPIRY & OVERDUE MANAGEMENT (REVIEW-ONLY MIGRATION)
-- File: migrations/014_wo_expiry_overdue_management.sql
--
-- KEBIJAKAN KESELAMATAN & NON-DESTRUCTIVE GUARANTEE:
-- 1. 100% additive & idempotent (CREATE OR REPLACE VIEW / CREATE INDEX IF NOT EXISTS).
-- 2. TIDAK melakukan DROP TABLE, DROP COLUMN, TRUNCATE, DELETE, atau bulk UPDATE
--    pada tabel `public.work_orders`.
-- 3. TIDAK pernah menimpa status asli WO (`status_wo_agent`, `status_wo_installer`,
--    `status_whatsapp`). OVERDUE adalah klasifikasi tampilan (display classification)
--    yang dievaluasi secara dinamis di database menggunakan timezone Asia/Jakarta (UTC+7).
-- 4. TIDAK menyentuh 3 record WO produksi yang dilindungi oleh trigger
--    `trg_protect_legacy_wo_mutation`.
-- 5. View menggunakan `security_invoker = true` dan hanya dapat diakses oleh
--    `service_role` (Express authoritative backend) tanpa paparan ke `anon`.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Indeks Parsial untuk Evaluasi Overdue & Appointment Date (Non-Destructive)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_active_appt_date
  ON public.work_orders (appointment_date ASC)
  WHERE is_deleted = FALSE AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_work_orders_active_status_appt
  ON public.work_orders (appointment_date, status_wo_agent, status_wo_installer)
  WHERE is_deleted = FALSE AND is_archived = FALSE;

-- ------------------------------------------------------------------------------
-- 2. Database-Side Authoritative Classification View: public.v_work_orders_classified
--    - Evaluates current calendar date in Asia/Jakarta (UTC+7) dynamically on every read.
--    - Works accurately at 00:00 WIB even when no user is logged in at midnight.
--    - Classifies into: TODAY | UPCOMING | OVERDUE | COMPLETED | EXCEPTION.
--    - Preserves original status_wo_agent, status_wo_installer, status_whatsapp intact.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_work_orders_classified
WITH (security_invoker = true) AS
SELECT
  w.*,
  (now() AT TIME ZONE 'Asia/Jakarta')::date AS jakarta_today,
  CASE
    WHEN w.appointment_date IS NULL THEN TRUE
    ELSE FALSE
  END AS is_exception,
  CASE
    WHEN (
      UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) NOT IN ('REJECTED', 'REVISI', 'REVISION', 'REVISION / REJECTED')
      OR LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
    )
    AND (
      LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
      OR UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) = 'APPROVED'
      OR w.closed_at IS NOT NULL
      OR LOWER(COALESCE(w.status_wo_agent, '')) IN ('done', 'resolved', 'closed', 'cancel', 'cancelled')
      OR LOWER(COALESCE(w.status_wo_installer, '')) IN ('completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled')
    )
    THEN TRUE
    ELSE FALSE
  END AS is_completed_status,
  CASE
    WHEN w.appointment_date IS NULL THEN 'EXCEPTION'
    WHEN (
      (
        UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) NOT IN ('REJECTED', 'REVISI', 'REVISION', 'REVISION / REJECTED')
        OR LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
      )
      AND (
        LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
        OR UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) = 'APPROVED'
        OR w.closed_at IS NOT NULL
        OR LOWER(COALESCE(w.status_wo_agent, '')) IN ('done', 'resolved', 'closed', 'cancel', 'cancelled')
        OR LOWER(COALESCE(w.status_wo_installer, '')) IN ('completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled')
      )
    ) THEN 'COMPLETED'
    WHEN w.appointment_date < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'OVERDUE'
    WHEN w.appointment_date = (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'TODAY'
    ELSE 'UPCOMING'
  END AS wo_classification,
  CASE
    WHEN w.appointment_date IS NULL THEN 'EXCEPTION'
    WHEN w.appointment_date < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'PAST'
    WHEN w.appointment_date = (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'TODAY'
    ELSE 'UPCOMING'
  END AS date_bucket,
  CASE
    WHEN w.appointment_date IS NOT NULL
      AND w.appointment_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND NOT (
        (
          UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) NOT IN ('REJECTED', 'REVISI', 'REVISION', 'REVISION / REJECTED')
          OR LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
        )
        AND (
          LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
          OR UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) = 'APPROVED'
          OR w.closed_at IS NOT NULL
          OR LOWER(COALESCE(w.status_wo_agent, '')) IN ('done', 'resolved', 'closed', 'cancel', 'cancelled')
          OR LOWER(COALESCE(w.status_wo_installer, '')) IN ('completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled')
        )
      )
    THEN GREATEST(0, ((now() AT TIME ZONE 'Asia/Jakarta')::date - w.appointment_date))
    ELSE 0
  END AS overdue_days,
  CASE
    WHEN w.appointment_date IS NOT NULL
      AND w.appointment_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND NOT (
        (
          UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) NOT IN ('REJECTED', 'REVISI', 'REVISION', 'REVISION / REJECTED')
          OR LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
        )
        AND (
          LOWER(COALESCE(w.payload->>'ticketResult', '')) = 'closed'
          OR UPPER(COALESCE(w.approval_status, w.payload->>'approvalStatus', '')) = 'APPROVED'
          OR w.closed_at IS NOT NULL
          OR LOWER(COALESCE(w.status_wo_agent, '')) IN ('done', 'resolved', 'closed', 'cancel', 'cancelled')
          OR LOWER(COALESCE(w.status_wo_installer, '')) IN ('completed', 'installed', 'failed / cancelled', 'cancel', 'cancelled')
        )
      )
    THEN
      CASE
        WHEN ((now() AT TIME ZONE 'Asia/Jakarta')::date - w.appointment_date) = 1 THEN '1_day'
        WHEN ((now() AT TIME ZONE 'Asia/Jakarta')::date - w.appointment_date) BETWEEN 2 AND 3 THEN '2_3_days'
        WHEN ((now() AT TIME ZONE 'Asia/Jakarta')::date - w.appointment_date) BETWEEN 4 AND 7 THEN '4_7_days'
        WHEN ((now() AT TIME ZONE 'Asia/Jakarta')::date - w.appointment_date) > 7 THEN 'gt_7_days'
        ELSE NULL
      END
    ELSE NULL
  END AS overdue_duration_bucket
FROM public.work_orders w
WHERE w.is_deleted = FALSE AND w.is_archived = FALSE;

-- ------------------------------------------------------------------------------
-- 3. Keamanan Akses View (Zero Anon Exposure, Express service_role authoritative)
-- ------------------------------------------------------------------------------
REVOKE ALL ON public.v_work_orders_classified FROM PUBLIC;
REVOKE ALL ON public.v_work_orders_classified FROM anon;
REVOKE ALL ON public.v_work_orders_classified FROM authenticated;
GRANT SELECT ON public.v_work_orders_classified TO service_role;

COMMIT;
