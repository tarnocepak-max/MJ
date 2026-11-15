# MORAJAWS — PURE SUPABASE FREE PLAN ARCHITECTURE

## 1. Ringkasan Arsitektur Final

MoraJaws kini beroperasi 100% di atas **Supabase PostgreSQL (Free Plan)** dan **Supabase Storage (Free Plan)** dengan **Express.js Backend Proxy** sebagai satu-satunya gerbang akses database serta **MoraJaws Custom Authentication** sebagai satu-satunya mesin identitas. Seluruh dependensi Firebase SDK, Cloud Firestore, Firebase Auth, Firebase Admin SDK, Firebase Storage SDK, serta Supabase Auth (`auth.users`) telah dihapus atau tidak digunakan.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ React 19 + TypeScript + Vite Frontend                                   │
│ - Zero Firebase SDK / Zero VITE_FIREBASE_*                              │
│ - Zero client-side Supabase keys / zero direct DB access                │
│ - HttpOnly cookies (mora_access_token, mora_refresh_token) + Bearer     │
│ - Google Sheets Sync via pure GIS OAuth (token only, zero Firebase)     │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ HTTPS / Fetch / EventSource (SSE)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Express.js Backend Proxy (server.ts)                                    │
│ - Middleware: resolveUserFromHeader + requireAuth + RBAC 6-Role Guards   │
│ - Custom Auth Engine (server/customAuthService.ts):                     │
│   * bcryptjs password hashing, access/refresh token rotation            │
│   * session_version revocation, 5-attempt brute-force lockout           │
│ - Database Adapter (server/supabaseAdapter.ts):                         │
│   * Queries Supabase via SUPABASE_SERVICE_ROLE_KEY (server-only)        │
│   * Fail-closed HTTP 503 DATABASE_UNAVAILABLE when ALLOW_LOCAL_JSON_MODE│
│     is false and Supabase is unreachable/unconfigured                   │
│ - Storage Adapter (server/supabaseStorage.ts):                          │
│   * Private bucket `morajaws-reports` via signed URLs (1h TTL)          │
│   * Legacy historical URL classifier (`legacy_external`)                │
│ - Free Plan Realtime (SSE):                                             │
│   * /api/supabase/realtime/stream (RBAC-filtered per user & role)       │
│   * /api/sandbox/realtime/stream (server/realtimeHub.ts, behind flag)   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ PostgREST / Storage REST (service_role)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Supabase Free Plan Platform                                             │
│ - PostgreSQL (21 public tables, RLS enabled, anon revoked)              │
│ - Trigger: trg_protect_legacy_wo_mutation (protects 3 legacy WOs)       │
│ - Storage Bucket: `morajaws-reports` (private, 1 GB Free Plan tier)     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Keputusan Teknis Supabase Free Plan

### 2.1 Live Updates: Express SSE + Targeted Polling
- Supabase Free Plan membatasi jumlah concurrent Realtime WebSocket connections dan pesan bulanan.
- MoraJaws memindahkan fan-out event ke **Express Server-Sent Events (SSE)**:
  - Endpoint produksi: `GET /api/supabase/realtime/stream` (wajib autentikasi; difilter berdasarkan role dan contractor/installer scope menggunakan `checkTicketAccess`).
  - Sandbox hub terisolasi: `server/realtimeHub.ts` dengan circular buffer maksimal 200 event, maksimal 3 koneksi per user, heartbeat 20 detik, dikontrol flag `ENABLE_SSE_SANDBOX=false`.
- Client (`src/context/AppContext.tsx`) menggabungkan EventSource SSE dengan targeted refresh/polling untuk Work Order, Live Chat, dan status sistem tanpa membebani kuota Supabase Realtime.

### 2.2 File Storage: Supabase Storage (`morajaws-reports`)
- Default provider pada `server/supabaseStorage.ts` dan `migrations/009_pure_supabase_alignment.sql` adalah `supabase` / `supabase_storage` dengan bucket privat **`morajaws-reports`**.
- Batas ukuran Free Plan yang ditegakkan oleh `STORAGE_VALIDATION_RULES`:
  - Signature / kecil: maksimal 2 MB
  - Foto bukti / laporan teknis (`image/jpeg`, `image/png`, `image/webp`): maksimal 5 MB
  - Dokumen / lampiran umum: maksimal 10 MB
  - Validasi magic bytes sebelum upload agar ekstensi palsu ditolak.
- File historis yang tersimpan sebelum migrasi (URL eksternal `firebasestorage.googleapis.com`, `.firebasestorage.app`, `storage.googleapis.com`) tetap dapat dibaca melalui klasifikasi `legacy_external` di `server/supabaseStorage.ts` dan `src/services/storageCompatibility.ts`.

### 2.3 Security & Fail-Closed Database Posture
- **Zero Client-Side Database Access**: Tidak ada kunci `SUPABASE_SERVICE_ROLE_KEY` maupun `SUPABASE_ANON_KEY` yang terekspos ke browser bundle (`vite.config.ts` / `src/`).
- **Deny-by-Default RLS**: Seluruh 21 tabel pada schema `public` mengaktifkan `ROW LEVEL SECURITY` dan `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`.
- **Fail-Closed Runtime Guard**: Saat `ALLOW_LOCAL_JSON_MODE=false` (default pada `.env.example`) dan `NODE_ENV=production`, seluruh operasi auth dan data mengembalikan HTTP `503 DATABASE_UNAVAILABLE` apabila koneksi Supabase tidak tersedia (`server.ts`, `server/customAuthService.ts`, `server/supabaseAdapter.ts`).

---

## 3. Autentikasi Internal & Matriks 6 Role

MoraJaws mempertahankan **Custom Authentication internal** berbasis Supabase PostgreSQL (`users`, `auth_sessions`, `refresh_tokens`, `login_attempts`, `audit_logs`):
- Login melalui `POST /api/auth/login` (atau alias `POST /api/auth/supabase-login`) menggunakan `username` atau `email` + `password` (`bcryptjs`).
- Endpoint usang `POST /api/auth/firebase-login` mengembalikan **HTTP `410 Gone`** (`FIREBASE_AUTH_REMOVED`).
- Header usang `x-auth-provider: firebase | google` ditolak dengan **HTTP `403 Forbidden`** (`EXTERNAL_AUTH_DISABLED`).
- Registrasi mandiri publik (`POST /api/auth/register`, `POST /api/auth/signup`) ditolak dengan **HTTP `403 Forbidden`**. Hanya **Superadmin** yang dapat mendaftarkan akun internal dan mereset kata sandi (`POST /api/auth/admin/reset-password`, yang memutakhirkan `session_version` dan mencabut seluruh sesi aktif).

Role resmi dan permission backend:
1. `super_admin` (25 permissions)
2. `dispatch` (10 permissions)
3. `leader` (5 permissions, scoped by contractor/area)
4. `installer` (4 permissions, scoped by assignment)
5. `management_data` (7 permissions)
6. `it_support` (6 permissions)

---

## 4. Alur Bisnis Operasional yang Dipertahankan

Seluruh workflow inti MoraJaws tetap utuh di atas backend Express + Supabase PostgreSQL:
1. **Master WO Import**: CSV, XLSX (`xlsx`), Text-to-Table, validasi koordinat & nomor HP, deteksi duplikat, dan audit trail batch.
2. **Contractor/Vendor Auto-Routing**: Pemetaan WO ke kontraktor dan area target.
3. **Leader Assignment & Reassignment**: Penugasan ke installer aktif dalam scope kontraktor tanpa menghapus progress atau chat sebelumnya.
4. **Installer Execution & Live Chat**: Check-in otomatis saat pesan `PROGRESS` pertama dikirim, check-out saat Technical Report dikirim, foto evidence via `morajaws-reports`.
5. **Dispatch Review & Closure**: Approval/Rejection laporan teknis, serta proteksi mutlak trigger DB terhadap 3 WO produksi historis (`wo_1793825457141_u4bnht`, `wo_imp_1793825458959_4i4f1h`, `wo_imp_1793825458959_262dei`).
6. **Integrasi Eksternal**: WhatsApp Click-to-Chat (`wa.me`), Google Maps (tampilan & validasi koordinat), dan Google Sheets Sync murni menggunakan Google Identity Services (GIS) OAuth client-side token.
