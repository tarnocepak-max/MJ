# AUDIT PHASE 0 — DEPLOYMENT READINESS REPORT

**Repository Scope:** MoraJaws (Cloudflare Pages Frontend Target + Express/Node.js Backend + Supabase)  
**Audit Mode:** Phase 0 Read-Only Discovery (Zero application source modifications)  
**Audit Date:** 2026-11-23  

---

## Classification Legend

- **Verified from source code** — Directly observed in files or verified via local CLI/runtime inspection.
- **Inferred but not verified** — Deduced from architecture and code behavior; requires staging/production execution to confirm.
- **Requires access to external hosting** — Depends on Cloudflare Pages or unknown Express hosting provider configuration.
- **Requires access to Supabase dashboard** — Depends on live Supabase project tables, buckets, extensions, or secrets.

---

## 1. Executive Readiness Verdict

**Current Production Deployment Readiness: NOT READY (BLOCKED by 6 structural/runtime blockers).**

While the React + Vite SPA (`npm run build`) and TypeScript check (`tsc --noEmit`) compile cleanly and the Express server runs under `tsx` in local development, shipping the codebase as-is to Cloudflare Pages + a standalone Express host will fail or misbehave due to startup crashes under `node server.ts`, missing frontend-to-backend origin/proxy routing, cross-origin cookie/CORS mismatches, unguarded local JSON fallback, and unverified live SQL/Storage schema parity.

---

## 2. Deployment Blockers & Gaps Matrix

| Area | Finding | Impact | Verification Status |
| :--- | :--- | :--- | :--- |
| **Node.js `npm start` Crash** | `"start": "node server.ts"` fails immediately with `SyntaxError` because `server/emailNotificationService.ts:15` imports TypeScript type `EmailNotificationEventType` from `./emailTemplateRenderer.ts` as a value import instead of `import type`. | Production container fails to boot under `npm start`. | **Verified from source code** (and runtime test on Node `v22.23.2`) |
| **TypeScript Production Build** | No `build:server` script exists; `tsx` is only in `devDependencies` (`package.json:59`) and `tsconfig.json` / `server.ts` rely on `.ts` relative import paths. | Running `npm ci --omit=dev && npm start` has neither compiled JS nor `tsx`. | **Verified from source code** |
| **Cloudflare Pages <-> Express API Routing** | Frontend exclusively sends relative `fetch('/api/...')` calls (`authService.ts`, `supabaseDb.ts`, `AppContext.tsx`). `VITE_API_BASE_URL` does not exist, and no `/_redirects` or `/functions/api/*` Cloudflare proxy exists in the repo. | Deployed Cloudflare Pages UI will send API/SSE calls to itself and receive 404/HTML instead of Express JSON/SSE. | **Verified from source code** (External Cloudflare proxy state: **Requires access to external hosting**) |
| **Express Hosting & Stateful Process** | Zero backend deployment files (`Dockerfile`, `fly.toml`, `render.yaml`, `railway.json`, `Procfile`, `.github/`). Backend requires a persistent single-instance stateful process for SSE (`backendRealtimeBus`, `PRESENCE_REGISTRY`), Supabase Realtime bridge, and WIB midnight/email timers. | Serverless or multi-replica deployments without sticky state/shared pubsub will break SSE presence, typing indicators, and duplicate scheduled jobs. | **Verified from source code** + **Requires access to external hosting** |
| **Fail-Open Local JSON Mode** | `isLocalJsonModeAllowed()` (`server.ts:427–431`) returns `true` whenever Supabase env vars are missing and `ALLOW_LOCAL_JSON_MODE` is not literally `'false'`. `.env.example` leaves `ALLOW_LOCAL_JSON_MODE=` empty. `data/morajaws_database.json` is written on startup in local mode. | Misconfigured prod env silently serves seed demo users (`12345678`) and local JSON data instead of failing closed with 503. | **Verified from source code** |
| **Cross-Origin Auth Cookies & CORS** | `server.ts:3792–3806, 3850–3864` sets `mora_access_token` and `mora_refresh_token` with `sameSite: 'lax'`. `logout` clears cookies without matching `secure`/`sameSite`. Production CORS (`server.ts:3025–3028`) only hardcodes `morajawskow.ai.studio`, `morajaws.ai.studio`, and `CORS_ALLOWED_ORIGINS`. `fetch()` calls mostly omit `credentials: 'include'`. | If Cloudflare Pages (`*.pages.dev` or `app.domain`) calls a different origin (`api.domain`), `SameSite=Lax` cookies will be dropped unless proxied same-origin or updated to `SameSite=None; Secure` + explicit CORS origin + `credentials: 'include'`. | **Verified from source code** |
| **Environment Isolation Module Unused** | `server/environmentConfig.ts` defines strict prod/staging isolation, but is never imported by `server.ts` or `server/supabaseClient.ts`. | Staging/production cross-credential guards (`STAGING_SUPABASE_PROJECT_ID` collision checks) never execute on startup. | **Verified from source code** |
| **Lockfile Parity (`bun.lock` vs `npm`)** | `bun.lock` is present; `package-lock.json` is absent. | Hosts using `npm ci` will fail without `package-lock.json` unless configured to use `bun install` or `npm install`. | **Verified from source code** + **Requires access to external hosting** |
| **Git Repository Missing in Workspace** | Workspace root has no `.git` directory. | Cannot create branch `repair/morajaws-production-readiness` or track diffs via git locally until git metadata is present. | **Verified from source code** |

---

## 3. Supabase & External Integration Readiness

### Verified from source code
- **Supabase Realtime Subscription Gap:** `server.ts:1472–1476` subscribes to `postgres_changes` on `work_orders`, `ticket_messages`, `contractors`, `coverage_areas`, and `app_settings`, whereas `migrations/003_system_error_logs_and_corrections.sql` only adds `work_orders`, `ticket_messages`, and `system_error_logs` to `supabase_realtime`. Updates made directly in Supabase to `contractors`, `coverage_areas`, or `app_settings` will not stream over the DB bridge unless added to the publication.
- **Database Migration Ambiguity:** 25 SQL files exist in `migrations/`, including duplicate `006_*`, five `007_*`, and competing auth models (`auth.users` vs Custom Auth `auth_sessions`). No automated migration ledger/runner tracks which migrations are applied.
- **Production Static Serving Check (`server.ts:16535–16565`):** When `NODE_ENV=production`, Express attempts to serve `dist/` and returns 503 HTML if `dist/index.html` is absent. If Express is deployed strictly as an API server (separate from Cloudflare Pages static hosting), `/api/health` works, but root `/` returns 503 unless `dist/` is built or a lightweight API-mode root response is provided.
- **Public Directory Exposure in `dist/`:** `vite.config.ts:7–35` (`distSecurityPlugin`) deletes `.zip`, `.bak`, `.sql`, `*backup*`, and `*database.json*` from `dist/`, **but does NOT strip `public/assets/aistudio/`** (112 files containing historical `server_revised_*.txt`, `supabaseAdapter_revised_*.txt`, and `Paste_*` source dumps). Running `vite build` copies all 112 unused files into Cloudflare Pages `dist/assets/aistudio/`, exposing historical source snapshots publicly.

### Inferred but not verified
- **SSE Buffering Behind Reverse Proxies:** `server.ts:12961` sets `X-Accel-Buffering: no` and sends 20s keepalives, while client `src/services/supabaseDb.ts:1165` enforces a 45s heartbeat watchdog. If Cloudflare Pages Functions or an intermediate CDN buffers SSE or enforces a 100s/short wall-clock limit, SSE connections may repeatedly drop and reconnect (`SSE_DISCONNECTED`).
- **SMTP Outbound Port 587 Reachability:** `server/emailNotificationService.ts` uses `nodemailer` over STARTTLS port 587 (`smtp.gmail.com`). Some PaaS/container providers block outbound port 587 by default unless explicitly permitted or relayed.

### Requires access to Supabase dashboard
- Exact list of applied migrations (`001`–`019`), active columns on `public.work_orders`, `public.users`, `public.auth_sessions`, `public.refresh_tokens`, `public.installer_sessions`, and `public.kendala_reports`.
- Whether Storage bucket `morajaws-reports` exists and enforces private access policies.
- Whether `supabase_realtime` publication includes all 5 subscribed tables.
- Actual production/staging Supabase credentials, SMTP secrets (`SMTP_USER`, `SMTP_PASS`), and webhook secrets (`RESEND_WEBHOOK_SECRET`, if used).

### Requires access to external hosting
- Cloudflare Pages custom domain(s), build settings, and whether any Cloudflare Worker / Pages Function / DNS route already proxies `/api/*`.
- Target Express hosting platform (e.g., Railway, Render, Fly.io, Cloud Run, or VPS/PM2), memory/timeout limits, and `trust proxy` depth.
