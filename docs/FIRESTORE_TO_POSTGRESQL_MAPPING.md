# MORAJAWS — FIRESTORE TO SUPABASE POSTGRESQL MAPPING

## 1. Pemetaan Koleksi Cloud Firestore ke Tabel PostgreSQL (`public`)

Seluruh akses baca/tulis yang dahulu diarahkan ke Cloud Firestore (atau `firestoreDb.ts` / `navigationFirestore.ts`) kini sepenuhnya diarahkan melalui Express Backend Proxy (`server.ts` -> `server/supabaseAdapter.ts`) ke 21 tabel PostgreSQL berikut:

| Legacy Firestore Collection / Path | Target PostgreSQL Table (`public`) | Primary Key & Relasi Utama | Catatan Implementasi |
|---|---|---|---|
| `tickets` | `work_orders` | `id` (text PK), `wo_number` (unique), `contractor_id` -> `contractors(id)` | Menyimpan kolom relasional (`installer_id`, `installer_uid`, `assigned_to`, `assigned_to_uid`, `chat_category`, `status_wo_agent`, `status_wo_installer`, `approval_status`) + JSONB `payload` & `additional_fields`. |
| `tickets/{id}/messages` | `ticket_messages` | `id` (text PK), `ticket_id` -> `work_orders(id)`, `sender_id` -> `users(id)` | Menyimpan kategori chat (`PROGRESS`, `ISSUE`, `REQUEST`, `GENERAL`), `attachment_id`, dan memicu update `work_orders.chat_messages_count`. |
| `tickets/{id}/technicalReports` / embedded report | `technical_reports` | `id` (text PK), `ticket_id` -> `work_orders(id)` | Menyimpan laporan teknis terstruktur (`report_status`, `reason_report`, `root_cause`, `optical_power_dbm`, `photo_before_url`, `photo_after_url`, `payload`). |
| `assignmentHistory` / embedded array | `assignment_history` | `id` (text PK), `ticket_id` -> `work_orders(id)`, `wo_number` | Jejak penugasan dan reassignment installer bersifat append-only. |
| `users` | `users` | `id` (text PK), `username` (unique), `email` (unique), `role` -> `roles(id)` | Menyimpan `password_hash` (`bcrypt`), `session_version`, `failed_login_count`, `locked_until`, `account_status`. Kolom legacy `firebase_uid` berstatus DEPRECATED (dipertahankan read-only). |
| `roles` | `roles` | `id` (text PK) | Menyimpan daftar 6 role resmi dan matriks permissions (`jsonb`). |
| `contractors` | `contractors` | `id` (text PK), `code` (unique) | Master data kontraktor/vendor dan daftar `coverage_areas` (`jsonb`). |
| `coverageAreas` | `coverage_areas` | `id` (text PK), `name` (unique) | Master data area & clusters (`jsonb`). |
| `waTemplates` | `wa_templates` | `id` (text PK) | Template pesan WhatsApp operasional. |
| `appSettings/ui_configuration`, `appSettings/navigation`, `appSettings/global`, droplists | `app_settings` | `key` (text PK) | Menggantikan dokumen `appSettings/*` di Firestore. UI Config Builder & Navigation Config membaca/menulis ke `/api/supabase/app-settings/:key`. |
| `userPreferences/{userId}` | `user_preferences` | `user_id` (text PK -> `users(id)`) | Preferensi UI & bahasa per pengguna. |
| `sessionConfig` | `session_config` | `id` (text PK) | Konfigurasi idle timeout & batas sesi. |
| `userSessions` | `user_sessions` | `session_id` (text PK), `user_id` -> `users(id)` | Sesi operasional pengguna yang dipantau Superadmin. |
| *(Custom Auth only)* | `auth_sessions` | `id` (text PK), `user_id` -> `users(id)` | Penyimpanan hash access token & lifecycle sesi Custom Authentication. |
| *(Custom Auth only)* | `refresh_tokens` | `id` (text PK), `session_id` -> `auth_sessions(id)`, `token_hash` | Mendukung refresh token rotation & deteksi reuse/revocation. |
| *(Custom Auth only)* | `login_attempts` | `id` (text PK) | Audit percobaan login & rate-limiting / brute-force lockout. |
| `attachments` / storage metadata | `attachments` | `id` (text PK), `ticket_id` -> `work_orders(id)` | Default `storage_provider = 'supabase_storage'`, `bucket_name = 'morajaws-reports'`, `sha256`, `file_category`. |
| `auditLogs` | `audit_logs` | `id` (text PK) | Append-only audit log (`action`, `entity`, `entity_type`, `entity_id`, `performed_by`, `user_role`, `payload`). |
| `integrationConfigs` | `integration_configs` | `id` (text PK) | Konfigurasi integrasi eksternal (Google Sheets metadata, tanpa secret token). |
| `syncHistory` | `sync_history` | `id` (text PK) | Riwayat sinkronisasi Google Sheets & batch import. |
| `systemErrorLogs` | `system_error_logs` | `id` (text PK) | Pelacakan error terstruktur (`error_code`, `backend_error_code`, `payload`). Kolom `firebase_error_code` berstatus DEPRECATED (read-only). |

---

## 2. Pemetaan Storage Bucket & Path Asset

| Legacy Firebase Storage | Target Supabase Storage (`morajaws-reports`) | Keterangan |
|---|---|---|
| `gs://<project>.appspot.com/...` atau URL `firebasestorage.googleapis.com` baru | Bucket privat `morajaws-reports` via `server/supabaseStorage.ts` | Upload baru memakai Supabase Storage & diakses lewat Signed URL (1 jam). |
| URL historis `firebasestorage.googleapis.com`, `.firebasestorage.app`, `storage.googleapis.com` | Tidak diubah di DB (`legacy_external`) | Dikenali sebagai `legacy_external` oleh `classifyFileSource` di backend & frontend agar data bukti historis tetap terbaca. |

---

## 3. Arsip Historis Backup Produksi & Rekaman Terproteksi

- File **`/data/morajaws_production_firestore_backup.json`** dipertahankan **secara read-only sebagai arsip historis**. Akses statis publik diblokir di `server.ts` (`/morajaws_production_firestore_backup.json` dan `/data/morajaws_production_firestore_backup.json` mengembalikan `403`), dan pengunduhan resmi hanya melalui endpoint terautentikasi `/api/admin/backup/morajaws-production/download` khusus `super_admin` dan `management_data`.
- Tiga rekaman WO produksi historis dilindungi secara mutlak oleh trigger PostgreSQL (`trg_protect_legacy_wo_mutation` pada `migrations/009_pure_supabase_alignment.sql`) serta guard aplikasi di `server.ts`:
  1. `wo_1793825457141_u4bnht`
  2. `wo_imp_1793825458959_4i4f1h`
  3. `wo_imp_1793825458959_262dei`
