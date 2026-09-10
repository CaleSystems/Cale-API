# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cale-api` — the standalone NestJS backend for the Cale platform, replacing Supabase as CalePOS's backend. See `../POS/PLATFORM_SETUP.md` for the full migration plan (this repo is Phase 1 onward of that plan's "Build order," section 6) and the architecture review artifact it links for the decision-by-decision rationale: https://claude.ai/code/artifact/9a543290-9875-453f-ac06-e5c1047f0a36

**Status (2026-08-28, partially superseded 2026-09-10): infra live, Identity has real auth now, the FIX-3 interceptor is wired globally, everything else still empty.** Module folders `catalog`, `commerce`, `inventory`, `ops`, `platform` are still empty Nest modules — no schema, no domain endpoints. `identity` is the one exception: 6 tables live on Neon `production` (the original 5 plus `sessions`, added 2026-09-10), and it now has a repository layer plus a working `AuthController` (`POST /api/v1/auth/{login,refresh,logout}` — argon2id PIN verification, JWT access/refresh, rotating refresh tokens with replay detection via `IdentityRepository`/`sessions`). `db/tenant-context.interceptor.ts` (`TenantContextInterceptor`) is registered globally in `app.module.ts` and opens a request-scoped transaction + `SET LOCAL`-equivalent context (`app.current_branch_id`/`app.current_staff_id`/`app.current_role`) for every authenticated route, but no business module has a controller yet, so nothing actually reads that context through RLS — it's infra ahead of Phase 2. Still not built in Identity: device tokens (D3) and the PBKDF2 offline-verifier port — see the Phase 1 table below. Don't assume any domain logic exists beyond that; check actual module contents before relying on this doc's description of intended shape.

**Repo location (2026-08-28):** this repo moved from `github.com/Xeazhar/calesystems-api`
to `github.com/CaleSystems/Cale-API` — repos now live under the `CaleSystems` GitHub
org, not the personal account. See `../POS/CLAUDE.md` (GitHub repo `CaleSystems/Cale-POS` --
the local folder is still named `POS`, that hasn't been renamed to match) and the org's
`.github` profile repo for the full platform repo index.

**Live infra:**
- **Render is disabled (2026-09-07).** The API is currently **not deployed anywhere** — do not
  assume `api.calecorp.com` or `calesystems-api.onrender.com` resolve to a live service. Render
  was dropped because its Starter-plan compute-hour billing didn't fit a solo operator who wants
  a flat, predictable cost, not a usage meter.
- **Hosting direction: a flat-fee VPS** (Hetzner/DigitalOcean/Linode, ~$5-6/mo, provider not yet
  chosen), running the existing `Dockerfile` directly — no PaaS layer on top. `docker-compose.prod.yml`
  runs the API container only (Neon Postgres stays managed and off-box). `.github/workflows/ci.yml`'s
  `deploy` job SSHes in and redeploys on every push to `main`, guarded on `VPS_HOST`/`VPS_SSH_KEY`
  repo secrets being set — it no-ops with a notice until the box exists and those secrets are added.
  This was chosen over serverless/scale-to-zero options because `pg-boss` (background jobs, FIX-1)
  and the planned WebSocket gateway (FIX-2) both need an always-running process; cold starts are
  also a bad fit for a POS backend where a cashier is waiting mid-sale.
- `GET /health` returns `{"status":"ok","db":"up"}` — real query against the Neon Postgres instance (DB `CaleSystem`), reachable once the VPS is up. `GET /health/deep` adds per-dependency detail (DB latency; R2 and outbox report `not_configured` until wired, which never fails the check).
- Neon Postgres, Cloudflare R2 bucket `cale-storage` (unused by code yet), Sentry org `xeazharr` with 4 projects created (only `cale-api`'s DSN is wired into this repo's `.env`; `calepos-web`/`-electron`/`-android` DSNs exist in Sentry but aren't in Cale-POS's frontend yet — no SDK installed there). **Path note (2026-09-06):** that frontend is `../POS/pos-frontend` on `main`; the rename to `client` exists only on the stale `platform` branch, so don't go looking for `../POS/client`.

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS + TypeScript |
| HTTP adapter | Fastify (wired in `main.ts`, swapped from the CLI's default Express) |
| API | REST at `/api/v1` (`setGlobalPrefix` in `src/bootstrap.ts`; `/health` and `/health/deep` are deliberately excluded so Render's probe keeps working), OpenAPI/Swagger (`@nestjs/swagger` installed, not yet wired) |
| Database | Standalone PostgreSQL, schemas per domain, hosted on Neon — **provisioned and connected**; first real tables landed 2026-09-09 (Identity's 5 tables, see Phase 1 table below) |
| ORM | Drizzle (`drizzle-orm` + `drizzle-kit`) — `apps/api/src/identity/identity.schema.ts` is the first schema file; DB access outside the health check now goes through `src/db/drizzle.provider.ts` (`DRIZZLE_DB`, wraps the same `PG_POOL`), not raw `pg.Pool` directly |
| Auth | In-house — `@nestjs/passport` + `@nestjs/jwt` wrapping argon2id hashing, Postgres-tracked sessions (not yet implemented) |
| Validation | `class-validator` + `class-transformer`, global `ValidationPipe({ whitelist: true, transform: true })` — **wired** in `main.ts` |
| Rate limiting | `@nestjs/throttler`, global `APP_GUARD` (60 req/min) as the floor — **wired** in `app.module.ts`. Stricter tiers for auth (10/min) and sync (120/min) are defined in `src/throttle.tiers.ts` and applied per-route with `@Throttle(...)`; no route uses them yet because no auth/sync routes exist |
| Config | `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })`) loading `.env` — added during the `main.ts` wiring pass, not in the original dependency list |
| Testing | Jest (unit) + Nest's e2e runner + `supertest` — e2e now includes a real `/health` round-trip against the live Neon DB, not mocked |
| Background jobs | `pg-boss` (installed, not yet used) |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` (bucket `cale-storage` created, not yet wired into code) |
| Error tracking | Sentry project `cale-api` created, DSN in `.env`/`.env.example` as `SENTRY_DSN` — **SDK not installed/wired yet** |

## Repo layout — pnpm workspace + Turborepo (2026-09-09)

This became a monorepo when Phase 1c's first item landed. Root-level commands run across
every workspace member via Turborepo; app-specific commands still run from `apps/api/`.

```
pnpm-workspace.yaml   # apps/*, packages/*
turbo.json            # build/lint/test pipeline
package.json          # root — "pnpm run build|lint|test" = turbo run <task>
apps/
  api/                # the NestJS app — everything that used to be at repo root
packages/
  contracts/          # @cale/contracts — Zod schemas + TS types, shared with clients.
                       # health.ts: /health and /health/deep response shapes, lifted
                       # from apps/api/src/app.controller.ts and app.service.ts.
                       # auth.ts: LoginRequest/RefreshRequest/AuthTokens, mirroring
                       # POST /auth/login|refresh|logout. Both are imported by
                       # apps/api itself now (identity/auth.dto.ts's LoginDto/RefreshDto
                       # `implements` the contract types; auth.service.ts's AuthTokens
                       # return type comes straight from the package) — the first real
                       # cross-package consumption, not just a mirrored shape sitting
                       # unused.
```

**Docker/CI build is now pnpm-workspace-aware (2026-09-10).** `apps/api` importing
`@cale/contracts` (above) was the documented trigger for this: `apps/api/Dockerfile` no
longer runs a standalone `npm ci` scoped to that directory (which can't resolve a
`workspace:*` dependency or see `packages/contracts` at all) — it now builds from the
**repo root** as context (`pnpm install --frozen-lockfile` at the root, then
`pnpm --filter cale-api --prod deploy /deploy` to bundle the app plus its resolved
production deps, `@cale/contracts` included, into one self-contained folder — the
pnpm-recommended pattern for a lean monorepo image). `apps/api/package-lock.json` is
gone; the workspace's `pnpm-lock.yaml` is now the only lockfile. Both callers were
updated to match: `ci.yml`'s `docker build -f apps/api/Dockerfile .` (context `.`, not
`apps/api`) and `docker-compose.prod.yml`'s `build.context: ../..`. A root-level
`.dockerignore` (`**/node_modules`, `**/dist`, `**/.env`, `.git`) is now load-bearing —
it's what stops the VPS's real `apps/api/.env` from ever reaching a build layer now that
the context is the whole repo.

**Security check on this migration (2026-09-10), one real regression caught and fixed:**
`pnpm --prod deploy` bundles a package's *entire* directory by default, not just its build
output — a first pass shipped `apps/api`'s full `src/`, `test/` (the e2e suites), eslint/
prettier/tsconfig configs, `docker-compose*.yml`, and even `.env.example` into the
"production" image, silently breaking the old Dockerfile's stated promise ("ships only
production deps + compiled output"). Fixed with a `"files": ["dist"]` allowlist on both
`apps/api/package.json` and `packages/contracts/package.json` — verified by re-running
`pnpm --filter cale-api --prod deploy` locally and confirming the output is only `dist/`,
`node_modules/`, and `package.json` (plus `README.md`/lockfile, which `npm`/`pnpm` pack
always includes regardless of `files` — harmless). Also added `USER node` to the runtime
stage — the image had no `USER` directive before or after this migration (a pre-existing
gap, not something this change introduced, but worth closing while rewriting the file);
`node:22-alpine` ships that unprivileged user already, no custom user needed. Confirmed
separately: `apps/api/.env` (real Neon connection string + JWT secrets) is gitignored and
was never committed, and `ConfigModule.forRoot({ isGlobal: true })` doesn't require a
`.env` file to be present at runtime — `docker-compose.prod.yml`'s `env_file:` injects
real process env vars directly, so excluding `.env`/`.env.example` from the image doesn't
break boot.

## Commands

```bash
# From the repo root — runs across every workspace member (apps/api + packages/*)
pnpm install
pnpm run build
pnpm run lint
pnpm run test

# From apps/api/ — app-specific, not covered by the root turbo pipeline
cd apps/api
npm run start:dev   # local dev server
npm run test:e2e    # e2e tests (Nest + supertest)
```

`DATABASE_URL` (Neon connection string) must be set in `apps/api/.env` — copy
`apps/api/.env.example` and fill it in, or these commands (and `GET /health`) will
fail/return `db: down`. See the same file for `SENTRY_DSN` too (unused by code today).

## Architecture

```
apps/api/src/
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
| 1a | Accounts & deploy surface | **partly undone (2026-09-07)** — Neon, R2, Sentry still live; Render was disabled and nothing replaces it yet. `docker-compose.prod.yml` + the CI `deploy` job are ready; needs a provisioned VPS + `VPS_HOST`/`VPS_SSH_KEY` secrets to actually deploy |
| 1b | API skeleton | **done** — `/api/v1` prefix, `/health` + `/health/deep`, `docker-compose.yml`, `drizzle.config.ts`, throttle tiers defined |
| 1c | Monorepo + `@cale/contracts`/`@cale/offline`/`@cale/ui`, identity module, FIX-3 interceptor, outbox relay, WebSocket gateway | **started (2026-09-09), identity auth + FIX-3 added 2026-09-10** — pnpm workspace + Turborepo scaffolded (`apps/api`, `packages/contracts`), `@cale/contracts` has one real schema pair (health/deep-health, mirrored from `apps/api`, not yet imported by it). **Identity module** — `organizations`/`branches`/`staff`/`staff_assignments`/`device_registrations` (Drizzle, D3's temporal tables) plus `staff.pinHash` and a `sessions` table added 2026-09-10, all migrated onto the real Neon `production` branch and verified live. `IdentityRepository` + `AuthService`/`AuthController` now cover login/refresh/logout (argon2id + rotating JWT refresh tokens); still missing: device tokens (D3), the PBKDF2 offline-verifier port. **FIX-3 interceptor** — `TenantContextInterceptor` is live as a global `APP_INTERCEPTOR`, opening a request-scoped transaction + `app.current_*` context for every authenticated route via `getTenantDb()` (`db/request-context.ts`); verified end-to-end in `test/tenant-context.interceptor.e2e-spec.ts` (commit/rollback correctness, no cross-request context leak on the shared pool), but no business module has a controller yet so it isn't exercised through real RLS policies yet. `@cale/offline`, `@cale/ui`, outbox relay, WebSocket gateway all still not started |
| 1d | RLS test harness, tested backup/restore, `.github/workflows/ci.yml` | partly — CI workflow exists (lint → migrate → unit → e2e → build → docker build → guarded VPS deploy); RLS harness and a timed restore drill are still missing. The "green run gates the release" property that Render's auto-deploy undermined is now true by construction — the CI `deploy` job *is* the only deploy path |

**Do not start Phase 2 until 1c and 1d are done**, and read `PLATFORM_SETUP.md`'s
"Exit criteria — when Phase 1 is actually done". Phase 2 consumes both: the RLS harness is what
makes porting 64 policies and 103 `SECURITY DEFINER` functions verifiable, and `@cale/contracts`
must exist *before* `src/lib/api/` is ported — extracting it afterwards is a rewrite.

**Two traps found while doing 1b — do not undo either:**

- **`/health` and `/health/deep` are excluded from the global prefix.** Render polls `/health`;
  moving it under `/api/v1` turns every deploy into a failed one. `test/app.e2e-spec.ts` asserts
  `/api/v1/health` 404s specifically to catch that regression.
- **`drizzle.config.ts` is excluded in `tsconfig.build.json`.** A `.ts` file at the repo root
  widens the TypeScript rootDir, which moves the build output from `dist/main.js` to
  `dist/src/main.js` and breaks both the Dockerfile's `CMD` and `start:prod`. Any new root-level
  `.ts` file needs the same exclusion.

**A trap found while doing Identity's auth (2026-09-10) — do not undo:** a rotated JWT refresh
token must carry a per-issuance random value (`AuthService`'s `RefreshTokenPayload.nonce`), not
just the session id as `jti`. Without it, two rotations signed within the same wall-clock second
are byte-identical (HS256 is deterministic given the same header+payload+secret, and `iat`/`exp`
only have 1-second resolution) — the "old" token isn't actually distinguishable from the new one,
so replay detection silently does nothing. Caught by `test/auth.e2e-spec.ts` failing intermittently
under fast local test runs, not by any assertion — if that test starts flaking again, check this
first.

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
