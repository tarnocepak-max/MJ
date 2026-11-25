# Security Summary

During the production audit of MoraJaws, the following security and data-integrity hardening improvements were verified and applied across the backend API and data-access layer:

1. **Query Filter Sanitization (`server/supabaseAdapter.ts`)**:
   - Hardened dynamic `.or(...)` filter expressions used in `getWorkOrdersFromSupabasePaginated`, `getTicketMessagesFromSupabase`, and `getTicketMessagesPaginatedFromSupabase` by introducing `sanitizePostgrestIlikeTerm` and `sanitizePostgrestQuotedValue`.
   - User-supplied search strings, contractor names, user IDs, and ticket/WO identifiers are stripped of filter syntax delimiters/wildcards and safely quoted for exact `.eq.` clauses so crafted inputs cannot alter query predicates.

2. **Strict Server-Side Input & Calendar Date Validation (`server.ts`, `server/supabaseAdapter.ts`, `src/components/textToTable/TextToTableImporter.tsx`, `src/context/AppContext.tsx`)**:
   - Prevented silent invalid-date erasure in `/api/tickets/bulk-import` and Google Sheets pull sync by validating calendar dates and rejecting malformed payloads with HTTP `400` and row-level diagnostics.
   - Added explicit primitive type checks for `woNumber`, `idCustomer`/`customerId`, and `customerName` so nested objects/booleans cannot be coerced into string values like `"[object Object]"`.

3. **Role-Based Access Control & Fail-Closed Production Behavior (`server.ts`, `src/services/supabaseDb.ts`)**:
   - Verified authentication (`401`) and role authorization (`403`) on bulk-import, admin audit, deletion, and template routes, including `installerUserId` scoping alignment inside `checkTicketAccess`.
   - Verified production mode (`NODE_ENV=production`) fails explicitly with HTTP `503` when the authoritative Supabase connection is unavailable rather than falling back to local JSON or mock data.

## PoC Verification

All security and production-regression checks passed against isolated in-memory test sessions and the compiled Vercel bundle (`api/_server.mjs`) without mutating production Supabase data:

- **Unauthenticated & Unauthorized Access Rejection**:
  - `POST /api/supabase/work-orders/bulk-import` without session token returned `401`.
  - `POST /api/supabase/work-orders/bulk-import` with an active `installer` session returned `403`.
  - `GET /api/audit-logs`, `POST /api/whatsapp/preview`, `DELETE /api/tickets/:id`, `POST /api/tickets/bulk-delete`, and `POST /api/tickets/purge-by-date` without credentials all returned `401` (`scripts/verify_phase9o_rbac_alignment.ts`: 26 passed, 0 failed).
- **Malformed Input & Invalid Date Rejection**:
  - Submitting invalid calendar dates (`2026-02-31`), empty/null rows, or non-primitive `woNumber` / `customerId` objects to `/api/tickets/bulk-import` and `/api/supabase/work-orders/bulk-import` returned HTTP `400` with explicit validation counts and preserved existing database records.
- **Cross-User RBAC Delta Sync Isolation**:
  - `GET /api/sync/delta` under `VERCEL=1` returned all imported tickets to `super_admin`, while scoping `installer` delta payloads strictly to work orders assigned to that installer's account ID and matching contractor.
- **Fail-Closed Production Database Check & Vercel Runtime Verification**:
  - Unsetting Supabase credentials under `NODE_ENV=production` returned HTTP `503` on bulk-import.
  - Invoking `api/index.js` -> `api/_server.mjs` with `VERCEL=1 NODE_ENV=production` handled `/api/index?__vercel_path=health` with HTTP `200` and zero missing-module errors.
