-- ==============================================================================
-- MORAJAWS MIGRATION 021: Soft Delete Consistency & Partial Unique Index WO Number
-- ==============================================================================
-- Tujuan:
-- 1. Mengubah unique index uq_work_orders_wo_number_normalized menjadi
--    PARTIAL UNIQUE INDEX (WHERE COALESCE(is_deleted, false) = false)
--    sehingga Work Order yang telah di-soft-delete tidak menyebabkan error
--    duplicate key (23505) jika nomor WO yang sama diimpor ulang di masa depan,
--    namun tetap menjamin keunikan 100% di antara WO aktif & arsip.
-- 2. Memperbarui RPC morajaws_find_existing_wo_numbers dan
--    morajaws_commit_import_batch_atomic agar hanya mendeteksi duplikasi pada
--    baris yang belum dihapus (COALESCE(is_deleted, FALSE) = FALSE), tanpa
--    menyentuh atau menghapus record historis (assignment_history, ticket_messages,
--    technical_reports, file_attachments).
-- 3. Menambahkan index ringan idx_work_orders_is_deleted_at untuk mendukung
--    tampilan pemulihan (Restore WO) oleh Superadmin.
--
-- ATURAN KEAMANAN:
-- - TIDAK ada DROP TABLE, TRUNCATE, atau DELETE data produksi.
-- - TIDAK mengubah foreign key yang sudah ada dan TIDAK memakai ON DELETE CASCADE.
-- ==============================================================================

BEGIN;

-- 1. Recreate normalized WO uniqueness index as partial unique index excluding soft-deleted rows
DROP INDEX IF EXISTS public.uq_work_orders_wo_number_normalized;

CREATE UNIQUE INDEX uq_work_orders_wo_number_normalized
ON public.work_orders (lower(regexp_replace(btrim(wo_number), '\s+', '', 'g')))
WHERE wo_number IS NOT NULL
  AND btrim(wo_number) <> ''
  AND COALESCE(is_deleted, false) = false;

-- 2. Partial index for Superadmin Soft-Deleted WO list & Restore lookup
CREATE INDEX IF NOT EXISTS idx_work_orders_is_deleted_at
ON public.work_orders (deleted_at DESC NULLS LAST, id)
WHERE COALESCE(is_deleted, false) = true;

-- 3. Align morajaws_find_existing_wo_numbers with partial unique index (active + archived only)
CREATE OR REPLACE FUNCTION public.morajaws_find_existing_wo_numbers(p_wo_numbers TEXT[])
RETURNS TABLE (canonical_wo TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH normalized_inputs AS (
    SELECT DISTINCT lower(regexp_replace(btrim(x), '\s+', '', 'g')) AS canon
    FROM unnest(COALESCE(p_wo_numbers, ARRAY[]::TEXT[])) AS x
    WHERE x IS NOT NULL AND btrim(x) <> ''
  )
  SELECT DISTINCT lower(regexp_replace(btrim(w.wo_number), '\s+', '', 'g')) AS canonical_wo
  FROM public.work_orders w
  JOIN normalized_inputs ni
    ON lower(regexp_replace(btrim(w.wo_number), '\s+', '', 'g')) = ni.canon
  WHERE w.wo_number IS NOT NULL
    AND btrim(w.wo_number) <> ''
    AND COALESCE(w.is_deleted, FALSE) = FALSE;
$$;

-- 4. Align morajaws_commit_import_batch_atomic with partial unique index
CREATE OR REPLACE FUNCTION public.morajaws_commit_import_batch_atomic(
  p_job_id TEXT,
  p_batch_number INTEGER,
  p_worker_id TEXT,
  p_wo_rows JSONB,
  p_duplicate_policy TEXT DEFAULT 'skip',
  p_duration_ms INTEGER DEFAULT 1,
  p_imported_by TEXT DEFAULT 'System',
  p_imported_by_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_job public.import_jobs%ROWTYPE;
  v_batch public.import_batches%ROWTYPE;
  v_row JSONB;
  v_wo_num TEXT;
  v_canon_wo TEXT;
  v_wo_id TEXT;
  v_existing_wo RECORD;
  v_payload JSONB;
  v_inserted_wos TEXT[] := ARRAY[]::TEXT[];
  v_updated_wos TEXT[] := ARRAY[]::TEXT[];
  v_dup_wos TEXT[] := ARRAY[]::TEXT[];
  v_failed_rows JSONB := '[]'::jsonb;
  v_row_err_msg TEXT;
  v_row_err_code TEXT;
  v_sr RECORD;
  v_fail_info JSONB;
  v_batch_total INTEGER := 0;
  v_batch_dup_pre INTEGER := 0;
  v_batch_inv_pre INTEGER := 0;
  v_batch_success INTEGER := 0;
  v_batch_updated INTEGER := 0;
  v_batch_dup_total INTEGER := 0;
  v_batch_failed_total INTEGER := 0;
  v_completed_batches INTEGER := 0;
  v_failed_batches INTEGER := 0;
  v_pending_batches INTEGER := 0;
  v_job_processed INTEGER := 0;
  v_job_successful INTEGER := 0;
  v_job_updated INTEGER := 0;
  v_job_dup INTEGER := 0;
  v_job_failed INTEGER := 0;
  v_next_job_status TEXT;
  v_completed_at TIMESTAMPTZ;
  v_error_summary TEXT;
  v_history public.import_history%ROWTYPE;
  v_history_written BOOLEAN := FALSE;
  v_has_more_pending BOOLEAN := FALSE;
  v_duration_job_ms INTEGER;
  v_dup_policy TEXT := COALESCE(NULLIF(btrim(p_duplicate_policy), ''), 'skip');
BEGIN
  IF v_dup_policy NOT IN ('skip', 'update_allowed') THEN
    RAISE EXCEPTION 'INVALID_DUPLICATE_POLICY: %', COALESCE(p_duplicate_policy, '<NULL>');
  END IF;

  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_JOB_NOT_FOUND: %', p_job_id;
  END IF;

  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'IMPORT_JOB_CANCELLED: Job % dibatalkan sebelum batch #% dapat di-commit.', p_job_id, p_batch_number;
  END IF;

  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE job_id = p_job_id
    AND batch_number = p_batch_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_BATCH_NOT_FOUND: % #%', p_job_id, p_batch_number;
  END IF;

  IF v_batch.status = 'completed' THEN
    RAISE EXCEPTION 'IMPORT_BATCH_ALREADY_COMPLETED: Batch #% sudah berstatus completed.', p_batch_number;
  END IF;

  IF v_batch.status <> 'processing' OR v_batch.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'IMPORT_BATCH_LOCK_LOST: Lock batch #% dipegang worker lain atau sudah kadaluarsa.', p_batch_number;
  END IF;

  IF p_wo_rows IS NOT NULL AND jsonb_typeof(p_wo_rows) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_wo_rows)
    LOOP
      v_wo_num := upper(regexp_replace(btrim(COALESCE(v_row->>'wo_number', v_row->>'work_order_number', '')), '\s+', '', 'g'));
      v_canon_wo := lower(v_wo_num);
      v_wo_id := COALESCE(
        NULLIF(btrim(v_row->>'id'), ''),
        'wo_' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
      );

      IF v_wo_num = '' OR v_canon_wo = '' THEN
        v_failed_rows := v_failed_rows || jsonb_build_array(
          jsonb_build_object('woNumber', '', 'errorCode', 'INVALID_WO', 'errorMessage', 'Nomor WO kosong.')
        );
        CONTINUE;
      END IF;

      -- Check ONLY active/archived rows (ignore soft-deleted rows per partial unique index)
      SELECT id, payload, is_deleted, is_archived
      INTO v_existing_wo
      FROM public.work_orders
      WHERE lower(regexp_replace(btrim(wo_number), '\s+', '', 'g')) = v_canon_wo
        AND COALESCE(is_deleted, FALSE) = FALSE
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        -- Never overwrite archived production records
        IF COALESCE(v_existing_wo.is_archived, FALSE) THEN
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
          CONTINUE;
        END IF;

        IF v_dup_policy = 'update_allowed' THEN
          BEGIN
            UPDATE public.work_orders
            SET
              appointment_date = COALESCE(NULLIF(btrim(v_row->>'appointment_date'), '')::date, appointment_date),
              slot_time = COALESCE(NULLIF(btrim(v_row->>'slot_time'), ''), slot_time),
              customer_phone = COALESCE(NULLIF(btrim(v_row->>'customer_phone'), ''), customer_phone),
              customer_contact1 = COALESCE(NULLIF(btrim(v_row->>'customer_contact1'), ''), customer_contact1),
              street_name = COALESCE(NULLIF(btrim(v_row->>'street_name'), ''), street_name),
              cluster_name = COALESCE(NULLIF(btrim(v_row->>'cluster_name'), ''), cluster_name),
              area = COALESCE(NULLIF(btrim(v_row->>'area'), ''), area),
              contractor_id = COALESCE(NULLIF(btrim(v_row->>'contractor_id'), ''), contractor_id),
              contractor_name = COALESCE(NULLIF(btrim(v_row->>'contractor_name'), ''), contractor_name),
              contactor_name = COALESCE(NULLIF(btrim(v_row->>'contactor_name'), ''), contactor_name),
              fat_code = COALESCE(NULLIF(btrim(v_row->>'fat_code'), ''), fat_code),
              fdt_code = COALESCE(NULLIF(btrim(v_row->>'fdt_code'), ''), fdt_code),
              leader_name = COALESCE(NULLIF(btrim(v_row->>'leader_name'), ''), leader_name),
              distribution_status = COALESCE(NULLIF(btrim(v_row->>'distribution_status'), ''), distribution_status),
              distribution_notes = COALESCE(NULLIF(btrim(v_row->>'distribution_notes'), ''), distribution_notes),
              payload = COALESCE(public.work_orders.payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                'leaderId', NULLIF(btrim(COALESCE(v_row->'payload'->>'leaderId', '')), ''),
                'leaderContact', NULLIF(btrim(COALESCE(v_row->'payload'->>'leaderContact', '')), ''),
                'distributionStatus', NULLIF(btrim(v_row->>'distribution_status'), ''),
                'distributionNotes', NULLIF(btrim(v_row->>'distribution_notes'), '')
              )),
              updated_at = v_now,
              updated_by = COALESCE(NULLIF(btrim(p_imported_by), ''), 'ImportUpdate')
            WHERE id = v_existing_wo.id;

            v_updated_wos := array_append(v_updated_wos, v_wo_num);
          EXCEPTION WHEN OTHERS THEN
            v_row_err_code := COALESCE(SQLSTATE, 'DB_UPDATE_ERROR');
            v_row_err_msg := SQLERRM;
            IF v_row_err_msg ILIKE '%PROTECTED_RECORD_MUTATION_FORBIDDEN%' THEN
              v_dup_wos := array_append(v_dup_wos, v_wo_num);
            ELSE
              v_failed_rows := v_failed_rows || jsonb_build_array(
                jsonb_build_object('woNumber', v_wo_num, 'errorCode', v_row_err_code, 'errorMessage', v_row_err_msg)
              );
            END IF;
          END;
        ELSE
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
        END IF;
        CONTINUE;
      END IF;

      -- Insert new Work Order (uses only verified baseline public.work_orders columns)
      v_payload := CASE WHEN jsonb_typeof(v_row->'payload') = 'object' THEN v_row->'payload' ELSE '{}'::jsonb END;
      BEGIN
        INSERT INTO public.work_orders (
          id, wo_number, work_order_number, id_customer, customer_id,
          ticket_number, ticket_date, date, appointment_date, date_upload, file_name, agent_id,
          customer_name, end_user_name, customer_phone, customer_contact1, customer_contact2, customer_contact3, customer_phone_normalized,
          street_name, street_alternatif, address, city, postal_code, cluster_name, area,
          appointment_type, slot_time, ticket_category, initial_ticket_category,
          installation_type, service_type, homepass_type, homepass_detail_id, olt_code, fdt_code, fat_code, fat_port, dropcore_length,
          plan, service_aging_maintenance, vendor_name, router, ont_brand, ont_model, router_brand, router_model, router_serial_number,
          stb1_sn, stb1_mac, stb2_sn, stb2_mac, stb3_sn, stb3_mac, ont_serial_number, ont_mac_address, rg_serial_number, rg_mac_address,
          contractor_id, contractor_name, contactor_name, leader_name, corlap_name, corlap_contact,
          installer_name, installer_contact, installer_contact2, installer_email,
          date_assign_agent, date_assign_technician, assigned_at, assigned_by, reassigned_at, reassigned_by, reassignment_reason,
          distribution_status, distribution_notes, status_wo_agent, status_wo_installer, status_whatsapp,
          remarks_wo_installer, remarks_agent, remarks,
          wa_message_preview, wa_generated_url, wa_last_opened_at, wa_confirmed_at, wa_confirmed_by, wa_confirmation_notes,
          chat_messages_count, last_message_at, last_message_snippet,
          check_in_at, work_session_status, work_sessions,
          closed_at, closed_by, close_notes, reopen_reason, technical_report,
          is_archived, archived_at, archived_by, is_deleted, deleted_at, deleted_by, deletion_reason,
          unmapped_headers, additional_fields, imported_at, import_date, import_batch_id,
          payload, created_at, updated_at, updated_by
        ) VALUES (
          v_wo_id,
          v_wo_num,
          COALESCE(NULLIF(btrim(v_row->>'work_order_number'), ''), v_wo_num),
          NULLIF(btrim(v_row->>'id_customer'), ''),
          NULLIF(btrim(v_row->>'customer_id'), ''),
          NULLIF(btrim(v_row->>'ticket_number'), ''),
          NULLIF(btrim(v_row->>'ticket_date'), '')::date,
          NULLIF(btrim(v_row->>'date'), '')::date,
          NULLIF(btrim(v_row->>'appointment_date'), '')::date,
          NULLIF(btrim(v_row->>'date_upload'), ''),
          NULLIF(btrim(v_row->>'file_name'), ''),
          NULLIF(btrim(v_row->>'agent_id'), ''),
          NULLIF(btrim(v_row->>'customer_name'), ''),
          NULLIF(btrim(v_row->>'end_user_name'), ''),
          NULLIF(btrim(v_row->>'customer_phone'), ''),
          NULLIF(btrim(v_row->>'customer_contact1'), ''),
          NULLIF(btrim(v_row->>'customer_contact2'), ''),
          NULLIF(btrim(v_row->>'customer_contact3'), ''),
          NULLIF(btrim(v_row->>'customer_phone_normalized'), ''),
          NULLIF(btrim(v_row->>'street_name'), ''),
          NULLIF(btrim(v_row->>'street_alternatif'), ''),
          NULLIF(btrim(v_row->>'address'), ''),
          NULLIF(btrim(v_row->>'city'), ''),
          NULLIF(btrim(v_row->>'postal_code'), ''),
          NULLIF(btrim(v_row->>'cluster_name'), ''),
          NULLIF(btrim(v_row->>'area'), ''),
          NULLIF(btrim(v_row->>'appointment_type'), ''),
          NULLIF(btrim(v_row->>'slot_time'), ''),
          NULLIF(btrim(v_row->>'ticket_category'), ''),
          NULLIF(btrim(v_row->>'initial_ticket_category'), ''),
          NULLIF(btrim(v_row->>'installation_type'), ''),
          NULLIF(btrim(v_row->>'service_type'), ''),
          NULLIF(btrim(v_row->>'homepass_type'), ''),
          NULLIF(btrim(v_row->>'homepass_detail_id'), ''),
          NULLIF(btrim(v_row->>'olt_code'), ''),
          NULLIF(btrim(v_row->>'fdt_code'), ''),
          NULLIF(btrim(v_row->>'fat_code'), ''),
          NULLIF(btrim(v_row->>'fat_port'), ''),
          NULLIF(btrim(v_row->>'dropcore_length'), ''),
          NULLIF(btrim(v_row->>'plan'), ''),
          NULLIF(btrim(v_row->>'service_aging_maintenance'), ''),
          NULLIF(btrim(v_row->>'vendor_name'), ''),
          NULLIF(btrim(v_row->>'router'), ''),
          NULLIF(btrim(v_row->>'ont_brand'), ''),
          NULLIF(btrim(v_row->>'ont_model'), ''),
          NULLIF(btrim(v_row->>'router_brand'), ''),
          NULLIF(btrim(v_row->>'router_model'), ''),
          NULLIF(btrim(v_row->>'router_serial_number'), ''),
          NULLIF(btrim(v_row->>'stb1_sn'), ''),
          NULLIF(btrim(v_row->>'stb1_mac'), ''),
          NULLIF(btrim(v_row->>'stb2_sn'), ''),
          NULLIF(btrim(v_row->>'stb2_mac'), ''),
          NULLIF(btrim(v_row->>'stb3_sn'), ''),
          NULLIF(btrim(v_row->>'stb3_mac'), ''),
          NULLIF(btrim(v_row->>'ont_serial_number'), ''),
          NULLIF(btrim(v_row->>'ont_mac_address'), ''),
          NULLIF(btrim(v_row->>'rg_serial_number'), ''),
          NULLIF(btrim(v_row->>'rg_mac_address'), ''),
          NULLIF(btrim(v_row->>'contractor_id'), ''),
          NULLIF(btrim(v_row->>'contractor_name'), ''),
          NULLIF(btrim(v_row->>'contactor_name'), ''),
          NULLIF(btrim(v_row->>'leader_name'), ''),
          NULLIF(btrim(v_row->>'corlap_name'), ''),
          NULLIF(btrim(v_row->>'corlap_contact'), ''),
          NULLIF(btrim(v_row->>'installer_name'), ''),
          NULLIF(btrim(v_row->>'installer_contact'), ''),
          NULLIF(btrim(v_row->>'installer_contact2'), ''),
          NULLIF(btrim(v_row->>'installer_email'), ''),
          NULLIF(btrim(v_row->>'date_assign_agent'), '')::timestamptz,
          NULLIF(btrim(v_row->>'date_assign_technician'), '')::timestamptz,
          NULLIF(btrim(v_row->>'assigned_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'assigned_by'), ''),
          NULLIF(btrim(v_row->>'reassigned_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'reassigned_by'), ''),
          NULLIF(btrim(v_row->>'reassignment_reason'), ''),
          COALESCE(NULLIF(btrim(v_row->>'distribution_status'), ''), 'pending'),
          NULLIF(btrim(v_row->>'distribution_notes'), ''),
          COALESCE(NULLIF(btrim(v_row->>'status_wo_agent'), ''), 'Pending'),
          COALESCE(NULLIF(btrim(v_row->>'status_wo_installer'), ''), 'Unassigned'),
          COALESCE(NULLIF(btrim(v_row->>'status_whatsapp'), ''), 'not_prepared'),
          NULLIF(btrim(v_row->>'remarks_wo_installer'), ''),
          NULLIF(btrim(v_row->>'remarks_agent'), ''),
          NULLIF(btrim(v_row->>'remarks'), ''),
          NULLIF(btrim(v_row->>'wa_message_preview'), ''),
          NULLIF(btrim(v_row->>'wa_generated_url'), ''),
          NULLIF(btrim(v_row->>'wa_last_opened_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'wa_confirmed_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'wa_confirmed_by'), ''),
          NULLIF(btrim(v_row->>'wa_confirmation_notes'), ''),
          GREATEST(0, COALESCE((v_row->>'chat_messages_count')::integer, 0)),
          NULLIF(btrim(v_row->>'last_message_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'last_message_snippet'), ''),
          NULLIF(btrim(v_row->>'check_in_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'work_session_status'), ''),
          CASE WHEN jsonb_typeof(v_row->'work_sessions') = 'array' THEN v_row->'work_sessions' ELSE '[]'::jsonb END,
          NULLIF(btrim(v_row->>'closed_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'closed_by'), ''),
          NULLIF(btrim(v_row->>'close_notes'), ''),
          NULLIF(btrim(v_row->>'reopen_reason'), ''),
          CASE WHEN jsonb_typeof(v_row->'technical_report') = 'object' THEN v_row->'technical_report' ELSE NULL END,
          COALESCE((v_row->>'is_archived')::boolean, FALSE),
          NULLIF(btrim(v_row->>'archived_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'archived_by'), ''),
          COALESCE((v_row->>'is_deleted')::boolean, FALSE),
          NULLIF(btrim(v_row->>'deleted_at'), '')::timestamptz,
          NULLIF(btrim(v_row->>'deleted_by'), ''),
          NULLIF(btrim(v_row->>'deletion_reason'), ''),
          CASE WHEN jsonb_typeof(v_row->'unmapped_headers') = 'array' THEN v_row->'unmapped_headers' ELSE '[]'::jsonb END,
          CASE WHEN jsonb_typeof(v_row->'additional_fields') = 'object' THEN v_row->'additional_fields' ELSE '{}'::jsonb END,
          COALESCE(NULLIF(btrim(v_row->>'imported_at'), '')::timestamptz, v_now),
          NULLIF(btrim(v_row->>'import_date'), '')::date,
          COALESCE(NULLIF(btrim(v_row->>'import_batch_id'), ''), p_job_id || '_b' || p_batch_number::text),
          v_payload,
          COALESCE(NULLIF(btrim(v_row->>'created_at'), '')::timestamptz, v_now),
          v_now,
          COALESCE(NULLIF(btrim(v_row->>'updated_by'), ''), p_imported_by, 'Import')
        );

        v_inserted_wos := array_append(v_inserted_wos, v_wo_num);
      EXCEPTION
        WHEN unique_violation THEN
          v_dup_wos := array_append(v_dup_wos, v_wo_num);
        WHEN OTHERS THEN
          v_row_err_code := COALESCE(SQLSTATE, 'DB_INSERT_ERROR');
          v_row_err_msg := SQLERRM;
          v_failed_rows := v_failed_rows || jsonb_build_array(
            jsonb_build_object('woNumber', v_wo_num, 'errorCode', v_row_err_code, 'errorMessage', v_row_err_msg)
          );
      END;
    END LOOP;
  END IF;

  -- Synchronize staging row states + error records for this batch atomically
  FOR v_sr IN
    SELECT *
    FROM public.import_staging_rows
    WHERE job_id = p_job_id
      AND batch_number = p_batch_number
      AND validation_status = 'valid'
      AND processing_status IN ('pending', 'processing', 'failed')
    ORDER BY row_number ASC
    FOR UPDATE
  LOOP
    v_canon_wo := lower(regexp_replace(btrim(COALESCE(v_sr.wo_number, '')), '\s+', '', 'g'));
    IF EXISTS (SELECT 1 FROM unnest(v_inserted_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo)
       OR EXISTS (SELECT 1 FROM unnest(v_updated_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo) THEN
      UPDATE public.import_staging_rows
      SET processing_status = 'succeeded', error_code = NULL, error_message = NULL, processed_at = v_now
      WHERE id = v_sr.id;
    ELSIF EXISTS (SELECT 1 FROM unnest(v_dup_wos) AS x WHERE lower(regexp_replace(btrim(x), '\s+', '', 'g')) = v_canon_wo) THEN
      UPDATE public.import_staging_rows
      SET
        processing_status = 'duplicate_skipped',
        error_code = 'DUPLICATE_CONFLICT',
        error_message = format('Nomor WO %s sudah terdaftar di database.', COALESCE(v_sr.wo_number, '')),
        processed_at = v_now
      WHERE id = v_sr.id;

      INSERT INTO public.import_row_errors (
        id, job_id, batch_number, row_number, wo_number, error_code, error_message, raw_payload, created_at
      ) VALUES (
        'imperr_' || p_job_id || '_r' || v_sr.row_number::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
        p_job_id,
        p_batch_number,
        v_sr.row_number,
        v_sr.wo_number,
        'DUPLICATE_CONFLICT',
        format('Nomor WO %s sudah terdaftar di database.', COALESCE(v_sr.wo_number, '')),
        COALESCE(v_sr.raw_payload, '{}'::jsonb),
        v_now
      );
    ELSE
      SELECT elem INTO v_fail_info
      FROM jsonb_array_elements(v_failed_rows) AS elem
      WHERE lower(regexp_replace(btrim(COALESCE(elem->>'woNumber', '')), '\s+', '', 'g')) = v_canon_wo
      LIMIT 1;

      v_row_err_code := COALESCE(NULLIF(v_fail_info->>'errorCode', ''), 'COMMIT_FAILED');
      v_row_err_msg := COALESCE(NULLIF(v_fail_info->>'errorMessage', ''), format('Baris WO %s gagal disimpan ke database.', COALESCE(v_sr.wo_number, '')));

      UPDATE public.import_staging_rows
      SET
        processing_status = 'failed',
        error_code = v_row_err_code,
        error_message = v_row_err_msg,
        processed_at = v_now
      WHERE id = v_sr.id;

      INSERT INTO public.import_row_errors (
        id, job_id, batch_number, row_number, wo_number, error_code, error_message, raw_payload, created_at
      ) VALUES (
        'imperr_' || p_job_id || '_r' || v_sr.row_number::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
        p_job_id,
        p_batch_number,
        v_sr.row_number,
        v_sr.wo_number,
        v_row_err_code,
        v_row_err_msg,
        COALESCE(v_sr.raw_payload, '{}'::jsonb),
        v_now
      );
    END IF;
  END LOOP;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'duplicate')::INTEGER,
    COUNT(*) FILTER (WHERE validation_status = 'invalid')::INTEGER
  INTO v_batch_total, v_batch_dup_pre, v_batch_inv_pre
  FROM public.import_staging_rows
  WHERE job_id = p_job_id AND batch_number = p_batch_number;

  v_batch_success := COALESCE(array_length(v_inserted_wos, 1), 0);
  v_batch_updated := COALESCE(array_length(v_updated_wos, 1), 0);
  v_batch_dup_total := v_batch_dup_pre + COALESCE(array_length(v_dup_wos, 1), 0);
  v_batch_failed_total := v_batch_inv_pre + COALESCE(jsonb_array_length(v_failed_rows), 0);

  UPDATE public.import_batches
  SET
    status = 'completed',
    processed_rows = v_batch_total,
    successful_rows = v_batch_success + v_batch_updated,
    updated_rows = v_batch_updated,
    duplicate_rows = v_batch_dup_total,
    failed_rows = v_batch_failed_total,
    error_message = NULL,
    duration_ms = GREATEST(1, COALESCE(p_duration_ms, 1)),
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL,
    processed_at = v_now,
    updated_at = v_now
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed')::INTEGER,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER,
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::INTEGER,
    COALESCE(SUM(updated_rows), 0)::INTEGER
  INTO v_completed_batches, v_failed_batches, v_pending_batches, v_job_updated
  FROM public.import_batches
  WHERE job_id = p_job_id;

  SELECT
    COUNT(*) FILTER (WHERE processing_status IN ('succeeded', 'duplicate_skipped', 'failed', 'cancelled'))::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'succeeded')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'duplicate_skipped')::INTEGER,
    COUNT(*) FILTER (WHERE processing_status = 'failed')::INTEGER
  INTO v_job_processed, v_job_successful, v_job_dup, v_job_failed
  FROM public.import_staging_rows
  WHERE job_id = p_job_id;

  IF v_job.status = 'cancelled' THEN
    v_next_job_status := 'cancelled';
    v_completed_at := v_job.completed_at;
    v_error_summary := v_job.error_summary;
  ELSIF v_pending_batches = 0 THEN
    v_completed_at := COALESCE(v_job.completed_at, v_now);
    IF v_failed_batches > 0 AND v_job_successful = 0 THEN
      v_next_job_status := 'failed';
      SELECT error_message INTO v_error_summary
      FROM public.import_batches
      WHERE job_id = p_job_id AND status = 'failed'
      ORDER BY batch_number ASC
      LIMIT 1;
      v_error_summary := COALESCE(v_error_summary, format('%s batch gagal diproses.', v_failed_batches));
    ELSIF v_failed_batches > 0 OR v_job_failed > 0 THEN
      v_next_job_status := 'completed_with_errors';
      v_error_summary := format('%s baris tidak valid/gagal diproses (%s batch error).', v_job_failed, v_failed_batches);
    ELSE
      v_next_job_status := 'completed';
      v_error_summary := NULL;
    END IF;
  ELSE
    v_next_job_status := 'processing';
    v_completed_at := NULL;
    v_error_summary := v_job.error_summary;
  END IF;

  UPDATE public.import_jobs
  SET
    processed_rows = v_job_processed,
    successful_rows = v_job_successful,
    updated_rows = v_job_updated,
    duplicate_rows = v_job_dup,
    failed_rows = v_job_failed,
    completed_batches = v_completed_batches,
    status = v_next_job_status,
    error_summary = v_error_summary,
    completed_at = v_completed_at,
    updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_has_more_pending := (v_pending_batches > 0);

  IF v_pending_batches = 0 AND v_next_job_status IN ('completed', 'completed_with_errors', 'failed') THEN
    v_duration_job_ms := CASE
      WHEN v_job.started_at IS NOT NULL THEN GREATEST(1, (extract(epoch FROM (COALESCE(v_completed_at, v_now) - v_job.started_at)) * 1000)::integer)
      ELSE NULL
    END;

    INSERT INTO public.import_history (
      id, job_id, original_job_id, import_name, source_file,
      imported_by, imported_by_id, total_rows, success_count,
      duplicate_count, failed_count, status, duration_ms, created_at
    ) VALUES (
      'imphist_' || p_job_id, p_job_id, p_job_id, v_job.import_name, v_job.source_file,
      v_job.created_by, v_job.created_by_id, v_job.total_rows, v_job_successful,
      v_job_dup, v_job_failed, v_next_job_status, v_duration_job_ms, v_now
    )
    ON CONFLICT (job_id) DO UPDATE SET
      original_job_id = COALESCE(public.import_history.original_job_id, EXCLUDED.original_job_id),
      import_name = EXCLUDED.import_name,
      source_file = EXCLUDED.source_file,
      total_rows = EXCLUDED.total_rows,
      success_count = EXCLUDED.success_count,
      duplicate_count = EXCLUDED.duplicate_count,
      failed_count = EXCLUDED.failed_count,
      status = EXCLUDED.status,
      duration_ms = EXCLUDED.duration_ms
    RETURNING * INTO v_history;

    v_history_written := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'batch', to_jsonb(v_batch),
    'insertedWoNumbers', to_jsonb(v_inserted_wos),
    'updatedWoNumbers', to_jsonb(v_updated_wos),
    'duplicateWoNumbers', to_jsonb(v_dup_wos),
    'failedRows', v_failed_rows,
    'hasMorePending', v_has_more_pending,
    'historyWritten', v_history_written,
    'history', CASE WHEN v_history_written THEN to_jsonb(v_history) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.morajaws_find_existing_wo_numbers(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.morajaws_commit_import_batch_atomic(TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.morajaws_find_existing_wo_numbers(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.morajaws_commit_import_batch_atomic(TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT) TO service_role;

COMMIT;
