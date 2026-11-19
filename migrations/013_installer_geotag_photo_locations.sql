-- ============================================================================
-- MORAJAWS MIGRATION 013: INSTALLER GEO-TAG PHOTO EVIDENCE & WO GPS LOCATIONS
-- Safe, backward-compatible migration:
-- - Adds nullable Lokasi Rumah (house_location) & Lokasi FAT (fat_location)
--   columns on public.work_orders (preserves legacy WOs & triggers).
-- - Creates public.wo_photo_evidence for per-photo GPS metadata, timestamps,
--   storage references, and retry idempotency.
--
-- Rollback instructions:
--   DROP TABLE IF EXISTS public.wo_photo_evidence;
--   ALTER TABLE public.work_orders
--     DROP COLUMN IF EXISTS house_location,
--     DROP COLUMN IF EXISTS house_latitude,
--     DROP COLUMN IF EXISTS house_longitude,
--     DROP COLUMN IF EXISTS house_accuracy_meters,
--     DROP COLUMN IF EXISTS house_captured_at,
--     DROP COLUMN IF EXISTS house_photo_url,
--     DROP COLUMN IF EXISTS house_captured_by,
--     DROP COLUMN IF EXISTS fat_location,
--     DROP COLUMN IF EXISTS fat_latitude,
--     DROP COLUMN IF EXISTS fat_longitude,
--     DROP COLUMN IF EXISTS fat_accuracy_meters,
--     DROP COLUMN IF EXISTS fat_captured_at,
--     DROP COLUMN IF EXISTS fat_photo_url,
--     DROP COLUMN IF EXISTS fat_captured_by;
-- ============================================================================

-- 1. Extend public.work_orders with nullable Lokasi Rumah & Lokasi FAT columns
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS house_location JSONB,
  ADD COLUMN IF NOT EXISTS house_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS house_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS house_accuracy_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS house_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS house_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS house_captured_by TEXT,
  ADD COLUMN IF NOT EXISTS fat_location JSONB,
  ADD COLUMN IF NOT EXISTS fat_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fat_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fat_accuracy_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fat_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fat_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS fat_captured_by TEXT;

CREATE INDEX IF NOT EXISTS idx_work_orders_house_coords
  ON public.work_orders (house_latitude, house_longitude)
  WHERE house_latitude IS NOT NULL AND house_longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_fat_coords
  ON public.work_orders (fat_latitude, fat_longitude)
  WHERE fat_latitude IS NOT NULL AND fat_longitude IS NOT NULL;

-- 2. Dedicated Geo-Tag Photo Evidence table
CREATE TABLE IF NOT EXISTS public.wo_photo_evidence (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number TEXT NOT NULL,
  slot_key TEXT NOT NULL CHECK (
    slot_key IN (
      'opm',
      'barcode_sn',
      'fat_pole',
      'customer_install',
      'customer_house',
      'fat_attenuation'
    )
  ),
  slot_title TEXT NOT NULL,
  storage_path TEXT,
  photo_url TEXT NOT NULL,
  file_name TEXT,
  file_size_bytes INTEGER,
  mime_type TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  gps_accuracy_meters DOUBLE PRECISION,
  altitude_meters DOUBLE PRECISION,
  heading_deg DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  captured_at TIMESTAMPTZ NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  technician_id TEXT NOT NULL,
  technician_name TEXT,
  location_source TEXT,
  permission_status TEXT,
  geotag_status TEXT NOT NULL DEFAULT 'missing' CHECK (
    geotag_status IN ('valid', 'weak', 'pending', 'failed', 'missing', 'gallery_unverified')
  ),
  capture_method TEXT NOT NULL DEFAULT 'camera' CHECK (
    capture_method IN ('camera', 'gallery')
  ),
  sha256 TEXT,
  client_capture_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_photo_evidence_ticket_slot
  ON public.wo_photo_evidence (ticket_id, slot_key, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_photo_evidence_client_capture
  ON public.wo_photo_evidence (ticket_id, slot_key, client_capture_id)
  WHERE client_capture_id IS NOT NULL;

ALTER TABLE public.wo_photo_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wo_photo_evidence_select_authenticated" ON public.wo_photo_evidence;
CREATE POLICY "wo_photo_evidence_select_authenticated"
  ON public.wo_photo_evidence
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "wo_photo_evidence_insert_service" ON public.wo_photo_evidence;
CREATE POLICY "wo_photo_evidence_insert_service"
  ON public.wo_photo_evidence
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "wo_photo_evidence_update_service" ON public.wo_photo_evidence;
CREATE POLICY "wo_photo_evidence_update_service"
  ON public.wo_photo_evidence
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
