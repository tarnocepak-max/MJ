-- =============================================================================
-- MORAJAWS MIGRATION 015: AUTOMATIC INSTALLER LOGIN & LIVE GPS TRACKING
-- Authoritative PostgreSQL Schema, Transactional Upsert RPC, Retention Cleanup & RLS
--
-- Tables:
--   1. public.installer_sessions           (1 record per Installer login session)
--   2. public.installer_current_locations  (1 latest live location record per Installer)
--   3. public.installer_location_history   (historical GPS breadcrumb trail w/ retention)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. public.installer_sessions
-- Menyimpan siklus sesi kerja Installer secara terpisah antara status Online/Offline
-- dan status Lokasi GPS (Location Fresh / Stale / GPS Disabled / Permission Denied / No Signal).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.installer_sessions (
  id TEXT PRIMARY KEY,
  installer_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  device_id TEXT,
  user_agent TEXT,
  login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_location_at TIMESTAMPTZ,
  logout_at TIMESTAMPTZ,
  online_status TEXT NOT NULL DEFAULT 'Online' CHECK (
    online_status IN ('Online', 'Offline')
  ),
  location_status TEXT NOT NULL DEFAULT 'Waiting for GPS' CHECK (
    location_status IN (
      'Location Fresh',
      'Location Stale',
      'GPS Disabled',
      'Permission Denied',
      'No Signal',
      'Waiting for GPS'
    )
  ),
  session_status TEXT NOT NULL DEFAULT 'active' CHECK (
    session_status IN ('active', 'ended', 'expired', 'superseded')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installer_sessions_installer_login
  ON public.installer_sessions (installer_id, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_installer_sessions_status_heartbeat
  ON public.installer_sessions (session_status, online_status, last_heartbeat_at DESC);

CREATE INDEX IF NOT EXISTS idx_installer_sessions_session_id
  ON public.installer_sessions (session_id);

-- -----------------------------------------------------------------------------
-- 2. public.installer_current_locations
-- Menyimpan tepat 1 koordinat terakhir per Installer (UNIQUE installer_id).
-- Koordinat palsu Null Island (0,0) atau di luar rentang bumi ditolak di level DB.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.installer_current_locations (
  id TEXT PRIMARY KEY,
  installer_id TEXT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL,
  location_status TEXT NOT NULL DEFAULT 'Location Fresh' CHECK (
    location_status IN (
      'Location Fresh',
      'Location Stale',
      'GPS Disabled',
      'Permission Denied',
      'No Signal',
      'Waiting for GPS'
    )
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_installer_current_valid_coords CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND latitude >= -90 AND latitude <= 90
      AND longitude >= -180 AND longitude <= 180
      AND NOT (abs(latitude) < 0.000001 AND abs(longitude) < 0.000001)
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_installer_current_locations_session
  ON public.installer_current_locations (session_id);

CREATE INDEX IF NOT EXISTS idx_installer_current_locations_recorded_at
  ON public.installer_current_locations (recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 3. public.installer_location_history
-- Menyimpan riwayat pergerakan GPS Installer dengan kebijakan retensi otomatis.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.installer_location_history (
  id TEXT PRIMARY KEY,
  installer_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (
    longitude >= -180
    AND longitude <= 180
    AND NOT (abs(latitude) < 0.000001 AND abs(longitude) < 0.000001)
  ),
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installer_location_history_installer_recorded
  ON public.installer_location_history (installer_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_installer_location_history_session
  ON public.installer_location_history (session_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_installer_location_history_created_at
  ON public.installer_location_history (created_at);

-- -----------------------------------------------------------------------------
-- 4. Transactional Atomic RPC: public.upsert_installer_live_location
-- Memastikan update sesi, upsert current location, dan insert history berjalan atomik
-- dalam satu transaksi database. Menolak session yang sudah berakhir/superseded.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_installer_live_location(
  p_installer_id TEXT,
  p_session_id TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION DEFAULT NULL,
  p_speed DOUBLE PRECISION DEFAULT NULL,
  p_heading DOUBLE PRECISION DEFAULT NULL,
  p_recorded_at TIMESTAMPTZ DEFAULT now(),
  p_record_history BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_now TIMESTAMPTZ := now();
  v_recorded TIMESTAMPTZ := COALESCE(p_recorded_at, v_now);
  v_current_id TEXT;
  v_history_id TEXT;
BEGIN
  IF p_installer_id IS NULL OR btrim(p_installer_id) = '' THEN
    RAISE EXCEPTION 'INVALID_INSTALLER_ID';
  END IF;
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'INVALID_SESSION_ID';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180
     OR (abs(p_latitude) < 0.000001 AND abs(p_longitude) < 0.000001) THEN
    RAISE EXCEPTION 'INVALID_GPS_COORDINATES';
  END IF;

  SELECT * INTO v_session
  FROM public.installer_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;
  IF v_session.installer_id <> p_installer_id THEN
    RAISE EXCEPTION 'SESSION_OWNER_MISMATCH';
  END IF;
  IF v_session.session_status <> 'active' THEN
    RAISE EXCEPTION 'SESSION_INACTIVE_%', upper(v_session.session_status);
  END IF;

  UPDATE public.installer_sessions
  SET last_heartbeat_at = v_now,
      last_location_at = GREATEST(COALESCE(last_location_at, v_recorded), v_recorded),
      online_status = 'Online',
      location_status = 'Location Fresh',
      updated_at = v_now
  WHERE id = v_session.id;

  v_current_id := 'icl_' || p_installer_id;

  INSERT INTO public.installer_current_locations (
    id, installer_id, session_id, latitude, longitude, accuracy, speed, heading,
    recorded_at, location_status, is_active, updated_at
  )
  VALUES (
    v_current_id, p_installer_id, p_session_id, p_latitude, p_longitude, p_accuracy, p_speed, p_heading,
    v_recorded, 'Location Fresh', true, v_now
  )
  ON CONFLICT (installer_id) DO UPDATE
  SET session_id = EXCLUDED.session_id,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      accuracy = EXCLUDED.accuracy,
      speed = EXCLUDED.speed,
      heading = EXCLUDED.heading,
      recorded_at = EXCLUDED.recorded_at,
      location_status = 'Location Fresh',
      is_active = true,
      updated_at = v_now;

  IF p_record_history THEN
    v_history_id := 'ilh_' || extract(epoch FROM v_now)::bigint::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    INSERT INTO public.installer_location_history (
      id, installer_id, session_id, latitude, longitude, accuracy, speed, heading, recorded_at, created_at
    )
    VALUES (
      v_history_id, p_installer_id, p_session_id, p_latitude, p_longitude, p_accuracy, p_speed, p_heading, v_recorded, v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'installer_id', p_installer_id,
    'session_id', p_session_id,
    'online_status', 'Online',
    'location_status', 'Location Fresh',
    'recorded_at', v_recorded,
    'updated_at', v_now,
    'history_id', v_history_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Retention Cleanup Function: public.cleanup_expired_installer_location_history
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_installer_location_history(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := GREATEST(1, LEAST(365, COALESCE(p_retention_days, 30)));
  v_deleted_count INTEGER := 0;
BEGIN
  DELETE FROM public.installer_location_history
  WHERE recorded_at < (now() - make_interval(days => v_days));
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security (RLS) Policies (Fail-Closed RBAC)
-- Seluruh akses backend menggunakan service_role; kebijakan authenticated mengikuti
-- hak akses role (super_admin/dispatch semua, leader contractor+area, installer own).
-- -----------------------------------------------------------------------------
ALTER TABLE public.installer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installer_current_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installer_location_history ENABLE ROW LEVEL SECURITY;

-- Service role full access
DROP POLICY IF EXISTS installer_sessions_service_role_all ON public.installer_sessions;
CREATE POLICY installer_sessions_service_role_all ON public.installer_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS installer_current_locations_service_role_all ON public.installer_current_locations;
CREATE POLICY installer_current_locations_service_role_all ON public.installer_current_locations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS installer_location_history_service_role_all ON public.installer_location_history;
CREATE POLICY installer_location_history_service_role_all ON public.installer_location_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated SELECT policies (RBAC-scoped by viewer user record)
DROP POLICY IF EXISTS installer_sessions_authenticated_select ON public.installer_sessions;
CREATE POLICY installer_sessions_authenticated_select ON public.installer_sessions
  FOR SELECT TO authenticated
  USING (
    installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
    OR EXISTS (
      SELECT 1 FROM public.users viewer
      WHERE viewer.id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
        AND viewer.active = true
        AND COALESCE(viewer.is_deleted, false) = false
        AND (
          viewer.role IN ('super_admin', 'dispatch')
          OR (
            viewer.role = 'leader'
            AND EXISTS (
              SELECT 1 FROM public.users inst
              WHERE inst.id = installer_sessions.installer_id
                AND lower(btrim(COALESCE(inst.contractor, ''))) = lower(btrim(COALESCE(viewer.contractor, '')))
                AND (
                  btrim(COALESCE(viewer.area, '')) = ''
                  OR lower(btrim(COALESCE(inst.area, ''))) = lower(btrim(COALESCE(viewer.area, '')))
                )
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS installer_current_locations_authenticated_select ON public.installer_current_locations;
CREATE POLICY installer_current_locations_authenticated_select ON public.installer_current_locations
  FOR SELECT TO authenticated
  USING (
    installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
    OR EXISTS (
      SELECT 1 FROM public.users viewer
      WHERE viewer.id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
        AND viewer.active = true
        AND COALESCE(viewer.is_deleted, false) = false
        AND (
          viewer.role IN ('super_admin', 'dispatch')
          OR (
            viewer.role = 'leader'
            AND EXISTS (
              SELECT 1 FROM public.users inst
              WHERE inst.id = installer_current_locations.installer_id
                AND lower(btrim(COALESCE(inst.contractor, ''))) = lower(btrim(COALESCE(viewer.contractor, '')))
                AND (
                  btrim(COALESCE(viewer.area, '')) = ''
                  OR lower(btrim(COALESCE(inst.area, ''))) = lower(btrim(COALESCE(viewer.area, '')))
                )
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS installer_location_history_authenticated_select ON public.installer_location_history;
CREATE POLICY installer_location_history_authenticated_select ON public.installer_location_history
  FOR SELECT TO authenticated
  USING (
    installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
    OR EXISTS (
      SELECT 1 FROM public.users viewer
      WHERE viewer.id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true))
        AND viewer.active = true
        AND COALESCE(viewer.is_deleted, false) = false
        AND (
          viewer.role IN ('super_admin', 'dispatch')
          OR (
            viewer.role = 'leader'
            AND EXISTS (
              SELECT 1 FROM public.users inst
              WHERE inst.id = installer_location_history.installer_id
                AND lower(btrim(COALESCE(inst.contractor, ''))) = lower(btrim(COALESCE(viewer.contractor, '')))
                AND (
                  btrim(COALESCE(viewer.area, '')) = ''
                  OR lower(btrim(COALESCE(inst.area, ''))) = lower(btrim(COALESCE(viewer.area, '')))
                )
            )
          )
        )
    )
  );

-- Installer self-insert/update protection (cannot spoof another installer_id)
DROP POLICY IF EXISTS installer_current_locations_self_write ON public.installer_current_locations;
CREATE POLICY installer_current_locations_self_write ON public.installer_current_locations
  FOR ALL TO authenticated
  USING (installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true)))
  WITH CHECK (installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true)));

DROP POLICY IF EXISTS installer_location_history_self_insert ON public.installer_location_history;
CREATE POLICY installer_location_history_self_insert ON public.installer_location_history
  FOR INSERT TO authenticated
  WITH CHECK (installer_id = COALESCE(auth.uid()::text, current_setting('request.jwt.claim.sub', true)));

COMMIT;
