# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cale-api` — the standalone NestJS backend for the Cale platform, replacing Supabase as CalePOS's backend. See `../POS/PLATFORM_SETUP.md` for the full migration plan (this repo is Phase 1 onward of that plan's "Build order," section 6) and the architecture review artifact it links for the decision-by-decision rationale: https://claude.ai/code/artifact/9a543290-9875-453f-ac06-e5c1047f0a36

**Status (2026-08-28): infra live, no domain code yet.** Module folders (`identity`, `catalog`, `commerce`, `inventory`, `ops`, `platform`) are still empty Nest modules — no schema, no auth, no domain endpoints. What *is* real: the app is deployed and reachable, with a live DB connection and a working health check. Don't assume any domain logic exists — check actual module contents before relying on this doc's description of intended shape.

**Repo location (2026-08-28):** this repo moved from `github.com/Xeazhar/calesystems-api`
to `github.com/CaleSystems/Cale-API` — repos now live under the `CaleSystems` GitHub
org, not the personal account. See `../POS/CLAUDE.md` (GitHub repo `CaleSystems/Cale-POS` --
the local folder is still named `POS`, that hasn't been renamed to match) and the org's
`.github` profile repo for the full platform repo index.

**Live infra:**
- Deployed on Render (`calesystems-api`, Starter plan, Oregon) from this repo's `main` branch (`CaleSystems/Cale-API`), auto-deploy on push.
- Reachable at `https://api.calecorp.com` (custom domain, DNS-only Cloudflare CNAME → `calesystems-api.onrender.com`, TLS via Render) and `https://calesystems-api.onrender.com`.
- `GET /health` returns `{"status":"ok","db":"up"}` — real query against the Neon Postgres instance (DB `CaleSystem`).
- Neon Postgres, Cloudflare R2 bucket `cale-storage` (unused by code yet), Sentry org `xeazharr` with 4 projects created (only `cale-api`'s DSN is wired into this repo's `.env`; `calepos-web`/`-electron`/`-android` DSNs exist in Sentry but aren't in Cale-POS's frontend yet — no SDK installed there). **Path note (2026-09-06):** that frontend is `../POS/pos-frontend` on `main`; the rename to `client` exists only on the stale `platform` branch, so don't go looking for `../POS/client`.

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS + TypeScript |
| HTTP adapter | Fastify (wired in `main.ts`, swapped from the CLI's default Express) |
| API | REST, intended at `/api/v1` (not yet prefixed), OpenAPI/Swagger (`@nestjs/swagger` installed, not yet wired) |
| Database | Standalone PostgreSQL, schemas per domain, hosted on Neon — **provisioned and connected**, no schema/tables beyond Neon's defaults yet |
| ORM | Drizzle (`drizzle-orm` + `drizzle-kit` installed, no schema written yet — current DB access is a raw `pg.Pool` for the health check only, see `src/db/pg-pool.provider.ts`) |
| Auth | In-house — `@nestjs/passport` + `@nestjs/jwt` wrapping argon2id hashing, Postgres-tracked sessions (not yet implemented) |
| Validation | `class-validator` + `class-transformer`, global `ValidationPipe({ whitelist: true, transform: true })` — **wired** in `main.ts` |
| Rate limiting | `@nestjs/throttler`, global `APP_GUARD` (60 req/min, not yet scoped to specific auth/sync routes since none exist) — **wired** in `app.module.ts` |
| Config | `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })`) loading `.env` — added during the `main.ts` wiring pass, not in the original dependency list |
| Testing | Jest (unit) + Nest's e2e runner + `supertest` — e2e now includes a real `/health` round-trip against the live Neon DB, not mocked |
| Background jobs | `pg-boss` (installed, not yet used) |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` (bucket `cale-storage` created, not yet wired into code) |
| Error tracking | Sentry project `cale-api` created, DSN in `.env`/`.env.example` as `SENTRY_DSN` — **SDK not installed/wired yet** |

## Commands

```bash
npm install
npm run start:dev   # local dev server
npm run build        # production build
npm test              # unit tests (Jest)
npm run test:e2e     # e2e tests (Nest + supertest)
npm run lint           # ESLint
```

`DATABASE_URL` (Neon connection string) must be set in `.env` — copy `.env.example` and fill it in, or these commands (and `GET /health`) will fail/return `db: down`. See `.env.example` for `SENTRY_DSN` too (unused by code today).

## Architecture

```
src/
  identity/     # staff, orgs, branches, RBAC, auth
  catalog/      # products, pricing, promotions
  commerce/     # orders, sales, payments
  inventory/
  ops/          # kitchen, delivery, rota routing
  platform/     # audit, sync, reporting
  main.ts
  app.module.ts
```

**Layering rule:** controllers → module services → Drizzle repositories. A module only ever touches its own tables. Cross-module interaction happens through that module's own service/API layer or outbox events — never a direct query into another module's schema. Once schemas exist, this is enforced two ways: code convention (repository layer) and a distinct Postgres role per module granted only on its own schema — see `PLATFORM_SETUP.md` section 6, "Phase 2 — POS parity" for the exact `CREATE ROLE`/`GRANT` pattern. A code-review miss should never become a runtime hole.

## Versioning

Not yet decided for this repo — `POS/client`'s MAJOR/MINOR-only convention (see its `CLAUDE.md`) is the likely starting point once this ships anything with external behavior, but that hasn't been confirmed for `cale-api` yet. Don't assume it applies here until this section is updated.

## Next steps

**Correction (2026-09-05):** this section previously mislabeled the phases — the work done so far (repos/accounts, `main.ts` wiring) is `PLATFORM_SETUP.md` **Phase 1**'s checklist, not Phase 2, and there is no "section 3.2"/"3.3"/"3.4" in that document.

**Phase 1 is NOT done (re-checked 2026-09-06).** It was rewritten into four groups because the
old version could be marked complete while none of its real deliverables existed:

| Group | What | Status |
|---|---|---|
| 1a | Accounts & deploy surface | done — Render, Neon, R2, Sentry, `api.calecorp.com` all live |
| 1b | API skeleton | partly — builds/deploys/health check work; no `/api/v1` prefix, no `/health/deep`, no `docker-compose.yml`, no `drizzle.config.ts` |
| 1c | Monorepo + `@cale/contracts`/`@cale/offline`/`@cale/ui`, identity module, FIX-3 interceptor, outbox relay, WebSocket gateway | **not started** |
| 1d | RLS test harness, tested backup/restore, `.github/workflows/ci.yml` | **not started** — this repo has no `.github/` at all, so Render auto-deploys `main` with nothing gating it |

**Do not start Phase 2 until 1c and 1d are done**, and read `PLATFORM_SETUP.md`'s
"Exit criteria — when Phase 1 is actually done". Phase 2 consumes both: the RLS harness is what
makes porting 64 policies and 103 `SECURITY DEFINER` functions verifiable, and `@cale/contracts`
must exist *before* `src/lib/api/` is ported — extracting it afterwards is a rewrite.

Two items in 1b have no visible symptom today and get expensive later:

- **`app.setGlobalPrefix('api/v1')`** — one line now. One of the platform's clients is an
  installed APK on a register that may be offline for days, so once a second client exists there
  is no way to ship a breaking change without a version to hang it on.
- **Throttler tiers** — the global 60 req/min `APP_GUARD` is a correct floor but the only tier;
  auth and sync routes need their own, tighter limits.

Phase 2 — POS parity is then split into four shippable slices (2a identity+auth → 2b catalog/inventory reads → 2c commerce/fiscal → 2d ops/reporting), each ending in a rehearsal. Read `PLATFORM_SETUP.md` section 6 "Phase 2 — POS parity" in full before starting.

**What Phase 2 actually is, measured (2026-09-06):** 31 tables, 64 RLS policies, 115 Postgres functions (74 called directly by the frontend), 21 triggers, and 232 exported functions (~9,100 LOC) in `../POS/pos-frontend/src/lib/api/`.

**Before porting any Postgres function, read the `SECURITY DEFINER` warning in that Phase 2 section.** 103 declarations exist specifically to *bypass* RLS; reproducing the 64 policies does not reproduce their gates. Each one becomes an explicit service-layer authorization check inside an explicit transaction, with a test proving the gate survived — or it becomes a privilege-escalation bug no RLS test will catch.

**Do not redesign invoice numbering during the port.** Port the existing semantics verbatim. Be precise about what they are: the client does **not** generate the number — it sends `null`, the offline receipt prints `localId` as its reference, and the server assigns the real number atomically at sync via `allocate_invoice_number` (row-locked on `branches.invoice_next`). `reserve_invoice_number` covers the case where a number *is* supplied, and `uq_transactions_branch_invoice` blocks duplicates.

That shipped design is correct about uniqueness but means **an offline sale hands the customer a receipt with no official invoice number** — a live BIR question, not a settled design. It is deferred out of the migration and tracked in `PLATFORM_SETUP.md` under FIX-4 as a pre-go-live decision. Do not resolve it inside the port, and do not record it as solved. Related open question: today's series is per **branch**, while the deferred block design assumes per **register**.

## Security & Fiscal Changes

Canonical list (mirrors `POS/client/CLAUDE.md`): authentication, authorization, RLS, payments, inventory, pricing, refunds, voids, taxes, invoice numbering, audit logs, sales records.

None of these exist as real code in this repo yet. Once they do:
- Treat the database/RLS layer as the security boundary, same as the Supabase-backed app did — **but note that RLS was never the whole boundary in the Supabase build.** 103 `SECURITY DEFINER` functions bypass RLS by design and enforce their rules procedurally. Anything ported from one of those needs its gate re-implemented as an explicit service-layer check inside an explicit transaction; the RLS policies alone will not carry it.
- `SET LOCAL app.current_branch_id` / `app.current_staff_id` must only ever be set inside an explicit transaction on a single connection — see `PLATFORM_SETUP.md` section 4, "FIX-3 — Make the three security layers debuggable" ("`SET LOCAL` correctness"), for why a bare pooled query is a real cross-branch leak, not a theoretical one.
- A request with no branch context set must be denied, not default-allowed.
- Don't weaken an existing security or fiscal control merely to make a feature easier to implement.
