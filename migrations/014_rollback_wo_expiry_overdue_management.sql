-- ==============================================================================
-- ROLLBACK SCRIPT FOR MIGRATION 014 (WO EXPIRY & OVERDUE MANAGEMENT)
-- File: migrations/014_rollback_wo_expiry_overdue_management.sql
--
-- Menghapus view & indeks yang ditambahkan oleh Migration 014 secara aman
-- tanpa menyentuh tabel maupun data `public.work_orders`.
-- ==============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_work_orders_classified;
DROP INDEX IF EXISTS public.idx_work_orders_active_status_appt;
DROP INDEX IF EXISTS public.idx_work_orders_active_appt_date;

COMMIT;
