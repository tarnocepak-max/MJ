# AUDIT PHASE 0 — SECURITY & INTEGRITY FINDINGS

**Repository Scope:** MoraJaws Web Application & Express Backend  
**Audit Mode:** Phase 0 Read-Only Discovery (Zero application source modifications)  
**Audit Date:** 2026-11-23  

---

## Classification Legend

- **Verified from source code** — Directly observed in repository files with exact file and line citations.
- **Inferred but not verified** — Deduced from code behavior/configuration; requires runtime or deployment confirmation.
- **Requires access to external hosting** — Depends on proxy/TLS/CORS/DNS setup on Cloudflare Pages or Express host.
- **Requires access to Supabase dashboard** — Depends on live Supabase RLS rules, roles, triggers, and Storage policies.

---

## 1. Critical & High Findings

### SEC-01 [CRITICAL] Public Exposure of Historical Backend Source Snapshots in `public/assets/aistudio/`
- **Status:** **Verified from source code**
- **Evidence:**
  - `/public/assets/aistudio/` contains **112 files**, including `server_revised_97d9a55f.txt`, `supabaseAdapter_revised_7ce9dc49.txt`, and 35+ extensionless `Paste_*` code/transcript dumps.
  - Grep across `src/`, `server/`, `server.ts`, `index.html`, and `vite.config.ts` confirms **0 references** to `/assets/aistudio/` or `public/assets/aistudio/`.
  - `vite.config.ts:19–28` (`distSecurityPlugin`) only purges `.zip`, `.bak`, `.sql`, `*backup*`, and `*database.json*`, allowing `.txt` and extensionless `Paste_*` backend snapshots to be copied into `dist/` and deployed publicly to Cloudflare Pages.
- **Impact:** Anyone browsing `/assets/aistudio/<filename>` on the deployed frontend can download historical server/adapter code and system architecture notes.
- **Planned Phase 5 Action:** Remove/quarantine unreferenced non-runtime files out of `public/assets/aistudio/` (confirming zero runtime references) and harden `distSecurityPlugin()` in `vite.config.ts`.

### SEC-02 [HIGH] Unresolved Installer Identity Allowed in Assignment & Reassignment + Missing Area Check
- **Status:** **Verified from source code**
- **Evidence:**
  - `server/supabaseAdapter.ts:4525–4556` (`assignTicketInSupabase`) and `server/supabaseAdapter.ts:4794–4825` (`reassignTicketInSupabase`):
    - When looking up `matchedInstaller` from `getUsersFromSupabase(false)`, active status and contractor scope are only checked **inside `if (matchedInstaller)`**.
    - If `getUsersFromSupabase(false)` fails or `matchedInstaller` is not found, both functions **silently proceed** using raw `effInstallerName` / `effNewInstaller` with `resolvedInstallerId = undefined` (`server/supabaseAdapter.ts:4582–4589, 4850–4857`), writing free-text `installer_name` without `installer_id`!
    - Neither function checks **Area** scope compatibility of the target installer when the Leader is area-scoped.
  - Additionally, `checkTicketAccess()` (`server.ts:2765–2772`) falls back to `ticket.assignedTo` when `installerId` / `installerUid` / `assignedToUid` are absent, and `assign`/`reassign` route handlers only pass `installerName` from `req.body` (`server.ts:5269, 13822, 13947`) rather than resolving by `installerId` first.
- **Impact:** Leader can assign/reassign a WO to a nonexistent or deactivated name string if lookup misses, breaking stable ID-based Installer access control (`installer_user_id` / `installerId`).

### SEC-03 [HIGH] Leader Contractor/Area Scope Bypass on WOs With Empty Contractor/Area Fields
- **Status:** **Verified from source code**
- **Evidence:**
  - `server/supabaseAdapter.ts:4502, 4511` (`assignTicketInSupabase`) and `server/supabaseAdapter.ts:4771, 4780` (`reassignTicketInSupabase`):
    ```ts
    if (!userContractor || (woContr && !isContractorMatch(woContr, userContractor)))
    if (userArea && targetWO.area && !isAreaMatch(targetWO.area, userArea))
    ```
  - When `woContr` is empty (`""`) or `targetWO.area` is empty (`""`), the condition short-circuits and **allows** a Leader to assign/reassign an unmapped/empty-scope Work Order rather than failing closed (`SCOPE_MISMATCH`).
  - Contrast `checkTicketAccess()` (`server.ts:2712, 2730`), which correctly fails closed if `ticketContr` or `ticketArea` (when `leaderArea` is set) is empty.
- **Impact:** Unmapped or incomplete WOs can be claimed or reassigned by any Leader instead of being routed to Superadmin exception handling.

### SEC-04 [HIGH] Local JSON Mode Fail-Open & Unconditional `db.tickets`/`db.users` Fallbacks
- **Status:** **Verified from source code**
- **Evidence:**
  - `server.ts:427–431`: `isLocalJsonModeAllowed()` returns `true` whenever `isSupabaseMode()` is `false` and `ALLOW_LOCAL_JSON_MODE !== 'false'`.
  - `.env.example:1` leaves `ALLOW_LOCAL_JSON_MODE=` empty.
  - `server.ts:1034–1035` seeds `INITIAL_SEED_USERS` (with `DEFAULT_HASH = hashPassword('12345678')`) and `INITIAL_SEED_TICKETS` into `data/morajaws_database.json` on startup when Supabase env vars are not active.
  - Unconditional `db.tickets` / `db.users` fallbacks remain even when Supabase mode is active in:
    - `GET /api/work-orders/:id` & `GET /api/tickets/:id` (`server.ts:13765–13767`)
    - `POST /api/storage/verify-access` (`server.ts:10248–10260`)
    - `GET /api/storage/adapter/download` (`server.ts:10729`)
    - `POST /api/storage/adapter/signed-url` (`server.ts:10780`)
    - `POST /api/storage/refresh-signed-url` (`server.ts:10131`) & `GET /api/storage/download` (`server.ts:10198`)
- **Impact:** Missing production Supabase env vars silently downgrade auth and WO data to demo seed data (`12345678`); partial Supabase misses can leak or evaluate against local memory fixtures.

### SEC-05 [HIGH] Auth Token Exposure in JSON + `localStorage` + CSRF Middleware Never Mounted
- **Status:** **Verified from source code**
- **Evidence:**
  - `server.ts:3792–3817` (`/api/auth/login`) and `server.ts:3850–3871` (`/api/auth/refresh`) set HttpOnly cookies (`mora_access_token`, `mora_refresh_token`), **AND simultaneously return raw `tokens` (`accessToken`, `refreshToken`) in the JSON response body**.
  - `src/services/authService.ts:190–206` and `src/context/AppContext.tsx` persist tokens in `localStorage.getItem('morajaws_auth_session')` and send `Authorization: Bearer <token>`, while most `fetch()` calls omit `credentials: 'include'`.
  - `validateCsrfProtection()` is defined and exported at `server.ts:1698–1720`, **but a repository-wide grep confirms it is NEVER invoked as Express middleware anywhere in `server.ts` or `server/`.**
  - `handleLogout` (`server.ts:3906–3907`) calls `res.clearCookie(...)` without matching `secure` / `sameSite` attributes, and login cookies use `sameSite: 'lax'` (`server.ts:3795, 3803`), which fails on cross-origin Cloudflare Pages <-> Express deployments.
- **Impact:** Tokens in `localStorage` remain readable to any XSS payload; cookie-authenticated endpoints lack active CSRF enforcement (`validateCsrfProtection` dead code).

---

## 2. Medium & Low Findings

### SEC-06 [MEDIUM] Destructive Automatic Role Mutation on Every Server Startup
- **Status:** **Verified from source code**
- **Evidence:** `consolidateLegacyRolesOnStartup()` (`server.ts:16626–16746`, called from `startServer()` at `server.ts:16812`) unconditionally promotes any `management_data` or `it_support` user in Supabase `public.users` to `super_admin`, increments `session_version`, revokes all their sessions, rewrites `app_settings`, and deletes `management_data` / `it_support` from `public.roles`.
- **Impact:** Startup boot performs implicit production DDL/DML-style privilege escalation & session revocation instead of running as an explicit one-time migration/script.

### SEC-07 [MEDIUM] Refresh Token Replay Detection Missing & Unsanitized `.or()` Filter Interpolation
- **Status:** **Verified from source code**
- **Evidence:**
  - `server/customAuthService.ts:869–874`: If an already-revoked refresh token is presented (`matchedRt.revokedAt` is set), `rotateRefreshToken` rejects the single token (`REFRESH_TOKEN_REVOKED`) but **does not revoke the parent session (`auth_sessions`) or descendant tokens in the token family**.
  - `server/customAuthService.ts:1134, 1139`: `revokeSingleSession(tokenOrSessionId)` interpolates raw `tokenOrSessionId` directly into PostgREST `.or(\`id.eq.${tokenOrSessionId},...\`)` without validating/escaping characters (note: `loginWithCustomAuth` / `verifyAccessToken` hash tokens before `.or()`, which is safe, whereas `revokeSingleSession` passes raw `tokenOrSessionId` if not a session ID/token format).
  - `server/customAuthService.ts:1225`: In local JSON mode, `u.altEmail.toLowerCase().includes(cleanIdent)` still uses substring matching (fixed in `supabaseAdapter.ts`, missed in `customAuthService.ts` local fallback).

### SEC-08 [MEDIUM] Wildcard CORS on Sandbox SSE & Unsanitized `Content-Disposition` Filename
- **Status:** **Verified from source code**
- **Evidence:**
  - `server/realtimeHub.ts:233`: Sandbox SSE handler sets `'Access-Control-Allow-Origin': '*'`.
  - `server.ts:10241, 10770`: Storage download sets `Content-Disposition: inline; filename="${fileName}"` using `path.basename(storagePath)` without stripping `"` or CR/LF characters.
  - `server.ts:3105`: Global CORS `Access-Control-Allow-Headers` omits `X-CSRF-Token` (relevant when wiring CSRF header protection in Phase 1).

### SEC-09 [MEDIUM] Test Scripts Reading `/proc/${pid}/environ`
- **Status:** **Verified from source code**
- **Evidence:** Three legacy test scripts still contain `fs.readFileSync(\`/proc/\${pid}/environ\`, 'utf-8')`:
  - `scripts/audit_supabase_db_schema.ts:10`
  - `scripts/test_realtime_sandbox.ts:10`
  - `scripts/test_phase6_rls_security.ts:12`
- **Impact:** Violates MoraJaws security rules and fails with `EACCES` or triggers runtime alerts in hardened production containers.

### SEC-10 [LOW / WORKFLOW PARITY] Bulk Import Role Mismatch & `localStorage` Caching of Tickets
- **Status:** **Verified from source code**
- **Evidence:**
  - `server.ts:2617`: `requireImportPermission` restricts `/api/tickets/bulk-import` strictly to `super_admin`, while PRD section 5.2 expects `super_admin` and `dispatch` (subject to configured permission) to perform WO import.
  - `src/context/AppContext.tsx` persists ticket/user state in `localStorage` for offline/cache convenience (risk on shared field devices if PII is cached unencrypted).

---

## 3. Supabase & External Security Verification Gaps

### Requires access to Supabase dashboard
- **RLS Enforcement When Using Service Role Key:** Because Express connects using `SUPABASE_SERVICE_ROLE_KEY`, PostgreSQL RLS is bypassed by the backend client (`server/supabaseClient.ts:215`). All tenant/role isolation (Leader contractor+area scope, Installer assignment scope) therefore depends **100% on Express middleware and `supabaseAdapter.ts`**, while direct `anon`/`authenticated` browser access to Supabase must remain blocked by strict RLS. Live RLS status on all 19+ tables cannot be verified without Supabase Dashboard SQL inspection.
- **Storage Bucket Public/Private Configuration:** Whether `morajaws-reports` is strictly private (no anonymous public download URLs) requires Supabase Storage dashboard inspection.

### Requires access to external hosting
- Whether HTTPS termination sets `X-Forwarded-Proto` and `X-Forwarded-Host` accurately (Note: `server.ts` does not call `app.set('trust proxy', 1)`, which affects `req.ip` rate limiting and `req.secure` behind Cloudflare/PaaS load balancers!).
- Whether Cloudflare Pages / hosting provider strips or forwards cookies and `Authorization` / `Origin` headers cleanly.
