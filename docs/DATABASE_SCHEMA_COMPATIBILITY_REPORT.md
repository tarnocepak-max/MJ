# MORAJAWS — DATABASE SCHEMA COMPATIBILITY REPORT

## 1. Tujuan Audit Kompatibilitas

Laporan ini memverifikasi kesesuaian antara skema SQL pada `/migrations/001` hingga `/migrations/009_pure_supabase_alignment.sql` dengan kontrak query backend (`server/supabaseAdapter.ts`, `server/customAuthService.ts`, `server/supabaseStorage.ts`, dan `server.ts`).

**Status Eksekusi Live Database**: **BLOCKED / NOT VERIFIED** (kredensial `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` tidak tersedia pada workspace ini; seluruh validasi SQL dilakukan melalui audit statis & pembuatan migrasi forward-only tanpa eksekusi ke database live/staging/production).

---

## 2. Temuan Ketidakcocokan Skema (001–008) & Resolusi di Migrasi `009`

| Area / Tabel | Temuan pada Migrasi `001`–`008` | Dampak pada Kode Backend | Resolusi Forward-Only (`009_pure_supabase_alignment.sql`) |
|---|---|---|---|
| `public.attachments` | `migrations/001` menetapkan `DEFAULT 'firebase_storage'` pada `storage_provider`; kolom `bucket_name`, `sha256`, `file_category` belum terstandarisasi. | Insert lampiran baru dari `server/supabaseStorage.ts` berisiko gagal kolom atau mewarisi default `firebase_storage`. | `ALTER COLUMN storage_provider SET DEFAULT 'supabase_storage'`; `ADD COLUMN IF NOT EXISTS bucket_name DEFAULT 'morajaws-reports', sha256, file_category`; tambah index `idx_attachments_storage_provider`. |
| `public.work_orders` | `migrations/006_phase16a` mereferensikan `installer_id`, namun kolom relasional `installer_id`, `installer_uid`, `assigned_to`, `assigned_to_uid`, `chat_category` tidak didefinisikan eksplisit sebagai kolom top-level di semua jalur migrasi. | Query filter/index pada `work_orders` berisiko gagal saat `006_phase16a` atau adapter melakukan lookup kolom relasional. | `ADD COLUMN IF NOT EXISTS installer_id, installer_uid, assigned_to, assigned_to_uid, chat_category`; tambah partial index `idx_work_orders_installer_id` dan `idx_work_orders_chat_category`. |
| `public.audit_logs` | `migrations/001` hanya memiliki `entity`, sedangkan `006_phase16a` & beberapa log query memakai `entity_type`. | Index atau query filter berbasis `entity_type` dapat gagal jika kolom tidak ada. | `ADD COLUMN IF NOT EXISTS entity_type text`. |
| `public.system_error_logs` | `migrations/003` memiliki `firebase_error_code`, sedangkan frontend (`src/services/errorSystem.ts`) dan adapter (`insertSystemErrorLogToSupabase`) mengirim `backend_error_code` & `payload`. | Error code backend hanya tersimpan di `metadata` dan nama kolom legacy membingungkan. | `ADD COLUMN IF NOT EXISTS backend_error_code text, payload jsonb NOT NULL DEFAULT '{}'::jsonb`; tambah index `idx_system_error_logs_backend_code`; tandai `firebase_error_code` `DEPRECATED` via `COMMENT ON COLUMN` tanpa `DROP COLUMN`. |
| `public.users` | Masih memiliki kolom legacy `firebase_uid` dari `migrations/001`. | Custom Auth (`customAuthService.ts`) tidak memakai `firebase_uid` sama sekali. | Menjaga kompatibilitas mundur dengan menambahkan `COMMENT ON COLUMN public.users.firebase_uid` berlabel `DEPRECATED`, **tanpa menghapus kolom atau data historis**. |
| RLS & Custom Auth | Beberapa policy pada `004`/`006_phase16a` menggunakan `auth.uid()` (pola Supabase Auth), padahal MoraJaws memakai Custom Auth via Express proxy (`service_role`). | Akses langsung via `anon` key tidak boleh pernah terbuka; seluruh trafik wajib lewat Express proxy. | Mengaktifkan kembali `ENABLE ROW LEVEL SECURITY` pada seluruh 21 tabel `public` dan mengeksekusi `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`. |
| Proteksi 3 Legacy WO | Wajib dijamin tetap utuh setelah seluruh migrasi. | Mutasi/penghapusan 3 WO historis dapat merusak integritas arsip produksi. | Menegakkan ulang secara idempoten fungsi `fn_protect_legacy_soft_deleted_wo()` dan trigger `trg_protect_legacy_wo_mutation` pada `public.work_orders`. |

---

## 3. Kesesuaian Kontrak `customAuthService.ts` dengan Tabel PostgreSQL

Tabel autentikasi yang diwajibkan oleh `server/customAuthService.ts` dan diverifikasi melalui `scripts/test_custom_authentication.ts`:
- `public.users`: `id`, `username`, `email`, `role`, `password_hash`, `session_version`, `active`, `is_deleted`, `failed_login_count`, `locked_until`, `account_status`, `must_change_password`, `payload`.
- `public.auth_sessions`: `id`, `user_id`, `session_id_hash`, `token_hash`, `expires_at`, `last_activity_at`, `revoked_at`, `ip_address`, `user_agent`.
- `public.refresh_tokens`: `id`, `user_id`, `session_id`, `token_hash`, `expires_at`, `revoked_at`, `replaced_by_token_hash`.
- `public.login_attempts`: `id`, `identifier`, `ip_address`, `success`, `reason`, `created_at`.
- `public.audit_logs`: mencatat event `ADMIN_CREATE_USER`, `ADMIN_RESET_PASSWORD`, `USER_LOGIN_SUCCESS`, `USER_LOGOUT`, dan `Access Denied`.

---

## 4. Panduan Penerapan Manual oleh DBA

Karena migrasi **`009_pure_supabase_alignment.sql`** belum dijalankan ke database live:
1. Pastikan migrasi `001`–`008` telah diterapkan berurutan pada database target.
2. Tinjau isi `/migrations/009_pure_supabase_alignment.sql` (bersifat **forward-only, idempotent, zero DROP/TRUNCATE/DELETE**).
3. Jalankan melalui Supabase SQL Editor atau `psql` pada Staging terlebih dahulu dan verifikasi tidak ada error pada 21 tabel maupun trigger `trg_protect_legacy_wo_mutation`.
4. Buat bucket privat **`morajaws-reports`** pada menu Supabase Storage sebelum mengaktifkan unggah lampiran produksi.
