# AUDIT PHASE 0 — ACTUAL REPOSITORY ARCHITECTURE

**Repository Scope:** MoraJaws Web Application & Express Backend  
**Audit Mode:** Phase 0 Read-Only Discovery (Zero application source modifications)  
**Audit Date:** 2026-11-23  

---

## Classification Legend

Every finding in this document is explicitly labeled using the four required verification levels:

- **Verified from source code** — Directly observed in repository files, build configuration, or local runtime command output.
- **Inferred but not verified** — Deduced from code patterns or documentation, but not runtime-verified end-to-end against live production infrastructure.
- **Requires access to external hosting** — Cannot be verified from the repository alone; depends on Cloudflare Pages / Express host settings.
- **Requires access to Supabase dashboard** — Cannot be verified from the repository alone; depends on the live Supabase project state, RLS policies, Realtime replication settings, and Storage buckets.

---

## 1. Repository & Stack Inventory

### Verified from source code
- **Workspace root:** No `.git` directory exists in the workspace root (`git status` exited with code 128: `not a git repository`). Branch creation (`repair/morajaws-production-readiness`) has **not** occurred yet and requires initializing or cloning the git repository/remote first.
- **Frontend Stack (`package.json`, `vite.config.ts`):**
  - React `^19.0.0`, TypeScript `^5.7.3`, Vite `^6.1.0`, `@tailwindcss/vite` `^4.0.0`.
  - Supporting client packages: `lucide-react`, `motion`, `leaflet`, `@zxing/browser`, `@zxing/library`, `xlsx`, `@google/genai`.
  - Direct Supabase browser client is intentionally disabled in `src/services/supabaseClient.ts:40–42` (`getClientSupabaseInstance()` returns `null`).
  - `vite.config.ts:55–62` injects `import.meta.env.VITE_SUPABASE_URL` (origin parsed from `process.env.SUPABASE_URL`) and `import.meta.env.VITE_SUPABASE_ANON_KEY` (`process.env.SUPABASE_ANON_KEY`) at build time, though `src/services/supabaseClient.ts` routes health checks through `fetch('/api/supabase/status')` instead of using a browser Supabase SDK instance.
- **Backend Stack (`package.json`, `server.ts`, `server/`):**
  - Express `^4.21.2` on Node.js (`v22.23.2` in current workspace), `cookie-parser`, `bcryptjs`, `dotenv`, `nodemailer` (`^10.6.1`), `@supabase/supabase-js` (`^2.118.0`).
  - Monolithic entry point `server.ts` (16,831 lines) exporting `createExpressApp()` and `startServer()`.
  - Supporting modules under `server/`: `supabaseClient.ts`, `supabaseAdapter.ts` (5,462 lines), `customAuthService.ts` (1,432 lines), `sessionStore.ts`, `supabaseStorage.ts` (1,726 lines), `supabaseAuthAdapter.ts`, `realtimeHub.ts`, `environmentConfig.ts`, `woClassificationService.ts`, `woLifecycleService.ts`, `emailNotificationService.ts`, `emailTemplateRenderer.ts`, `installerGpsTrackingService.ts`, `passwordResetService.ts`, `slaTelemetryService.ts`, `appFlowHelpers.ts`, `supabaseShadowService.ts`, and `server/sandbox/*`.
- **Package Lockfile:**
  - `bun.lock` exists at repo root (`package-lock.json` is absent). All 31 dependencies declared in `package.json` exist in `bun.lock`.

### Requires access to external hosting
- Whether the Cloudflare Pages project builds using `bun install` or `npm install`, and what build command / Node version is configured in Cloudflare Pages dashboard.

---

## 2. Architecture Questions (Items A–J)

### A. Does the Express server function as a standalone backend?
- **Verified from source code:** **Yes.** `server.ts` defines `createExpressApp(options)` and `startServer()`, registering over 100 `/api/*` endpoints (auth, users, RBAC, tickets/work-orders, assignment/reassignment, photo evidence, kendala reports, livechat, WhatsApp templates, GPS tracking, storage adapter, email notifications, realtime SSE, audit logs, and health checks).
- **Verified from source code (build coupling caveat):** `server.ts:10` imports `import type { Ticket } from './src/types/index.ts'`, and `server/woClassificationService.ts` / adapters exist alongside frontend `src/services/woClassificationService.ts`. While type-only imports from `src/` do not bundle React, runtime execution via `node server.ts` is affected by TypeScript type-stripping rules (see Item G).

### B. Can the Express backend run independently of Vite dev server?
- **Verified from source code:** **Yes.** In `server.ts:16535–16566`:
  - When `NODE_ENV=production`, `createExpressApp()` skips `createViteServer(...)` entirely and mounts `express.static(distDir)` + `/assets` + SPA fallback (`dist/index.html`), returning HTTP 503 HTML if `dist/index.html` is absent.
  - In non-production mode, passing `{ skipVite: true }` disables Vite middleware mounting.
  - Wait/API-only nuance: In `NODE_ENV=production`, if deployed as an API-only backend *without* running `vite build` locally on the backend host (because frontend is hosted on Cloudflare Pages), any non-`/api/*` route hitting the backend will return the 503 `"MoraJaws Production Build Belum Siap"` HTML page unless `dist/` exists or an API-only mode is supported.

### C. How does the React frontend send API requests?
- **Verified from source code:** All frontend network calls use **relative `/api/...` paths**:
  - `src/services/authService.ts`: `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/admin/users/*`, `/api/auth/change-password`, `/api/auth/reset-password-token`, `/api/admin/password-reset/jobs/*`.
  - `src/services/supabaseClient.ts:59`: `fetch('/api/supabase/status')`.
  - `src/services/supabaseDb.ts:1216`: `fetch('/api/supabase/realtime/stream')`, `/api/tickets/:id/messages`.
  - `src/context/AppContext.tsx` and feature services (`installerGpsTrackingService.ts`, etc.): relative `/api/...` paths.
- **Verified from source code:** **`VITE_API_BASE_URL` (or any configurable backend origin helper) does NOT exist** anywhere in `src/`, `vite.config.ts`, or `index.html`. (A grep across the codebase returned zero active matches; the only occurrence in the entire repo is an archived text dump under `public/assets/aistudio/Paste_October_28__2026_-_5_23PM_e7f19bb7:461`).
- **Architectural Consequence:** If the React bundle on Cloudflare Pages is served from a different origin than the Express backend **without** a Cloudflare Pages reverse proxy for `/api/*`, every frontend API call will fail by hitting Cloudflare Pages static 404/SPA fallback instead of Express.

### D. Is there existing deployment configuration for the Express backend?
- **Verified from source code:** **No.** There is no `Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`, `railway.json`, `Procfile`, `ecosystem.config.*`, `.github/workflows/*`, `cloudbuild.yaml`, or deployment manifest anywhere in the repository.
- **Requires access to external hosting:** The Express hosting provider, region, process manager, and deployment pipeline are completely unknown from the repository.

### E. Is there Cloudflare Pages proxy configuration for `/api/*`?
- **Verified from source code:** **No.** Neither `/_redirects`, `/_headers`, `/functions/api/[[path]].ts` (Pages Functions), nor `wrangler.toml` exists in the repository or under `/public/`.
- **Requires access to external hosting:** Whether Cloudflare Workers/Routes or DNS-level reverse proxies exist outside the repository in Cloudflare Dashboard cannot be determined from source code.

### F. Does the backend depend on a persistent process (SSE, background schedulers, in-memory state)?
- **Verified from source code:** **Yes — the current backend assumes a single, long-lived, stateful Node.js process:**
  1. **SSE & Presence (`server.ts:12952–13125`):** `/api/supabase/realtime/stream` relies on in-process `EventEmitter` (`backendRealtimeBus`), `ACTIVE_SSE_CONNECTION_IDS` (`Set`), `PRESENCE_REGISTRY` (`Map`), `TYPING_REGISTRY` (`Map`), and `REALTIME_TICKET_SCOPE_CACHE`. These are not shared across multiple containers/workers.
  2. **Supabase Postgres Realtime Bridge (`server.ts:1469–1497`, `server.ts:16813`):** Subscribes to `postgres_changes` via a single in-process Realtime WebSocket channel (`morajaws-server-db-sync`) and fans events out to local SSE listeners.
  3. **In-Memory Session Store (`server/sessionStore.ts` & `server.ts:1524`):** `MemorySessionStore` and `SERVER_SESSIONS` are single-instance arrays; `RedisSessionStoreStub` explicitly throws `REDIS_UNAVAILABLE` (`multiInstanceSupported: false`). However, `customAuthService.ts` does persist `auth_sessions` and `refresh_tokens` into Supabase PostgreSQL, partially mitigating session loss across restarts for Supabase-backed auth.
  4. **In-Process Schedulers (`server.ts:2986`, `server.ts:3013`):** `scheduleNextJakartaMidnightRollover()` (00:00 WIB daily date rollover) and `startEmailNotificationScheduler()` run via `setTimeout` / `setInterval` inside the Express process.
  5. **Ephemeral In-Memory Caches:** `LOGIN_ATTEMPTS` rate-limit Map (`server.ts:1525`), password rate-limit maps, and config cache (`invalidateGlobalConfigCache`) reside in memory (with DB fallbacks for `login_attempts` in `customAuthService.ts`).

### G. Does `package.json` `"start": "node server.ts"` work cleanly in Node.js?
- **Verified from source code & runtime command:** **NO — `node server.ts` FAILS immediately at startup.**
  - Under Node `v22.23.2` (native TypeScript type-stripping), executing `node -e "import('./server.ts')..."` fails with:
    `SyntaxError: The requested module './emailTemplateRenderer.ts' does not provide an export named 'EmailNotificationEventType'`
  - **Root cause (`server/emailNotificationService.ts:15–18`):** `EmailNotificationEventType`, `EmailTemplateConfig`, `EmailTemplateKey`, and `EmailTemplateRenderContext` are TypeScript `type`/`interface` declarations in `server/emailTemplateRenderer.ts`, but `server/emailNotificationService.ts` imports them as value imports instead of `import type`. Node 22's native strip-types requires `import type` for type-only exports across ESM `.ts` modules (unlike `tsx`, which uses esbuild).
  - **Additional Node compatibility note (`tsconfig.json`, `package.json`):** `server.ts` and `server/*.ts` use `.ts` relative import specifiers (`allowImportingTsExtensions` or `tsx`). With `"start": "node server.ts"`, production fails unless either (a) all type imports use `import type` AND Node >=22.6/22.18+ strip-types handles all TypeScript syntax used (note: enums, parameter properties, or non-erasable syntax also fail native strip-types), or (b) backend is compiled to JS (`dist-server/`) or started with `tsx server.ts` (`tsx` is currently in `devDependencies`, not `dependencies`).

### H. Does `server/environmentConfig.ts` isolate staging/production effectively, and is it used?
- **Verified from source code:** **Defined cleanly, but COMPLETELY UNUSED in production server code.**
  - `server/environmentConfig.ts` (521 lines) implements strict environment isolation (`production` / `staging` / `development`), `STAGING_SUPABASE_PROJECT_ID = 'lvytgqsvxntnvlohmrxi'`, `validateEnvironmentStartup()`, `resolveAuthRedirectUrl()`, and `getSessionCookieName()`.
  - **Grep verification across `server.ts` and `server/`:** Zero files import or call `environmentConfig.ts`, `getEnvironmentConfig()`, `validateEnvironmentStartup()`, or `getSessionCookieName()`.
  - Instead, `server/supabaseClient.ts` reads `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, and `process.env.SUPABASE_SECRET_KEY` directly (`server/supabaseClient.ts:16–30, 195–196`), bypassing all cross-environment checks in `environmentConfig.ts`.

### I. Does local JSON fallback (`data/morajaws_database.json`) or seed data still activate in production?
- **Verified from source code:** **YES — critical fail-open fallback behavior exists:**
  1. `isLocalJsonModeAllowed()` (`server.ts:427–431`):
     ```ts
     export function isLocalJsonModeAllowed(): boolean {
       if (isSupabaseMode()) return false;
       if (process.env.ALLOW_LOCAL_JSON_MODE === 'false') return false;
       return true;
     }
     ```
     Because `ALLOW_LOCAL_JSON_MODE` is blank in `.env.example` and defaults to allowed whenever `isSupabaseMode()` is `false`, a production server deployed without valid `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` silently falls back to local JSON mode with `INITIAL_SEED_USERS` (including `DEFAULT_HASH = hashPassword('12345678')`) and `INITIAL_SEED_TICKETS`, instead of failing closed.
  2. `loadDatabaseFromDisk()` (`server.ts:1022–1076`) is called unconditionally inside `createExpressApp()` (`server.ts:2957`), and `data/morajaws_database.json` (16,307 bytes) currently exists on disk in this workspace (written when dev server initialized without Supabase env vars).
  3. Several API handlers (`GET /api/work-orders/:id` at `server.ts:13765–13767`, `POST /api/storage/verify-access` at `server.ts:10246–10261`, `GET /api/storage/adapter/download` at `server.ts:10729`, `POST /api/storage/adapter/signed-url` at `server.ts:10780`, `GET /api/storage/download` at `server.ts:10198`, `POST /api/storage/refresh-signed-url` at `server.ts:10131`) reference `db.tickets` or `db.users` unconditionally or as a fallback even when `isLocalJsonModeAllowed()` is false.

### J. Are SQL migrations in `migrations/` consistent or conflicting?
- **Verified from source code:** **25 `.sql` files in `migrations/` contain severe numbering collisions, conflicting auth models, and unfinished drafts:**
  - **Duplicate migration numbers:**
    - Two `006_*` files: `006_custom_authentication_schema.sql` (Custom Auth without `auth.users`) vs `006_phase16a_schema_alignment_and_droplists.sql` (marked `DRAFT`).
    - Five `007_*` files: `007_phase16a2_1_preflight_schema_audit.sql` (read-only audit), `007_phase16a2_rollback_plan.sql`, `007_phase16a2_staging_account_alignment_reference.sql` (staging reference), `007_phase16a2_staging_schema_initialization.sql` (binds `public.users` to `auth.users`), and `007_provision_primary_superadmin.sql` (PBKDF2 superadmin seed).
    - Two `014_*` files: `014_wo_expiry_overdue_management.sql` and `014_rollback_wo_expiry_overdue_management.sql`.
  - **Conflicting Auth & RLS Models:**
    - `001_core_morajaws_schema.sql` and `002_schema_corrections.sql` (whose header still says `MIGRATION 001`) reference Firebase Auth + Firebase Storage.
    - `005_add_auth_user_id_to_users.sql`, `007_phase16a2_staging_schema_initialization.sql`, and `017_consolidate_roles_to_super_admin.sql` RLS policies (`lines 180–271`) depend on `auth.uid()` / `public.users.auth_user_id` (Supabase Auth).
    - `006_custom_authentication_schema.sql` and `008_phase1_custom_auth_session_version_alignment.sql` implement MoraJaws Custom Auth (`auth_sessions`, `refresh_tokens`, `login_attempts`) removing `auth.users` dependency, matching active `server.ts` login endpoints (`/api/auth/login`).
  - **Realtime Publication Mismatch:**
    - `migrations/003_system_error_logs_and_corrections.sql:83–97` adds only `work_orders`, `ticket_messages`, and `system_error_logs` to `supabase_realtime`.
    - `server.ts:1472–1476` subscribes `postgres_changes` on **5** tables: `work_orders`, `ticket_messages`, `contractors`, `coverage_areas`, and `app_settings`. No migration in `migrations/` adds `contractors`, `coverage_areas`, or `app_settings` to `supabase_realtime`.
- **Requires access to Supabase dashboard:** Cannot determine from source code alone which subset of the 25 SQL files has already been executed on the live production or staging Supabase databases, nor which RLS policies/publications are currently active.

---

## 3. Data & Workflow Architecture Summary

### Verified from source code
- **Authoritative Data Access Layer (`server/supabaseAdapter.ts`):** Handles mapping between camelCase application models and snake_case PostgreSQL tables (`work_orders`, `users`, `roles`, `contractors`, `coverage_areas`, `ticket_messages`, `assignment_history`, `app_settings`, `audit_logs`, `installer_sessions`, `kendala_reports`, `email_notification_*`, etc.).
- **Protected Records:** `PROTECTED_PRODUCTION_WO_IDS` (`server.ts:421–425`) hard-protects `wo_1793825457141_u4bnht`, `wo_imp_1793825458959_4i4f1h`, and `wo_imp_1793825458959_262dei` from mutation/deletion.
- **Role Structure:** Backend and frontend auth matrices (`src/services/authService.ts:39–102`, `server.ts:16626–16746`, `migrations/017_consolidate_roles_to_super_admin.sql`) enforce 4 consolidated roles (`super_admin`, `dispatch`, `leader`, `installer`), removing `management_data` and `it_support`.
- **Conflict/Edge Cases Noted:**
  - `server.ts:2617` (`requireImportPermission`) restricts `/api/tickets/bulk-import` strictly to `super_admin`, whereas PRD section 5.2 specifies Superadmin and Dispatch have import rights according to configured permission.
  - `server.ts:16626–16746` (`consolidateLegacyRolesOnStartup`) mutates `users`, `roles`, and `app_settings` automatically on every server boot if legacy roles or strings appear.

### Inferred but not verified
- Whether all columns written by `supabaseAdapter.ts` (e.g., `installer_user_id`, `house_location`, `fat_location`, `session_version`, `kendala_reports`) exist in the live Supabase production database depends on whether migrations `008`–`019` have been applied.

### Requires access to Supabase dashboard
- Actual schema state (`information_schema.columns`), active `pg_publication_tables` for `supabase_realtime`, presence of Storage bucket `morajaws-reports`, and live RLS policy definitions on production Supabase.
