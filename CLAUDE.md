# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cale-api` — the standalone NestJS backend for the Cale platform, replacing Supabase as CalePOS's backend. See `../cale-pos/PLATFORM_SETUP.md` for the full migration plan (this repo is Phase 2 onward of that plan) and the architecture review artifact it links for the decision-by-decision rationale: https://claude.ai/code/artifact/9a543290-9875-453f-ac06-e5c1047f0a36

**Status (2026-08-28): infra live, no domain code yet.** Module folders (`identity`, `catalog`, `commerce`, `inventory`, `ops`, `platform`) are still empty Nest modules — no schema, no auth, no domain endpoints. What *is* real: the app is deployed and reachable, with a live DB connection and a working health check. Don't assume any domain logic exists — check actual module contents before relying on this doc's description of intended shape.

**Repo location (2026-08-28):** this repo moved from `github.com/Xeazhar/calesystems-api`
to `github.com/CaleSystems/Cale-API` — repos now live under the `CaleSystems` GitHub
org, not the personal account. See `../cale-pos/CLAUDE.md` (repo `CaleSystems/Cale-POS`, formerly `../POS`) and the
org's `.github` profile repo for the full platform repo index.

**Live infra:**
- Deployed on Render (`calesystems-api`, Starter plan, Oregon) from this repo's `main` branch (`CaleSystems/Cale-API`), auto-deploy on push.
- Reachable at `https://api.calecorp.com` (custom domain, DNS-only Cloudflare CNAME → `calesystems-api.onrender.com`, TLS via Render) and `https://calesystems-api.onrender.com`.
- `GET /health` returns `{"status":"ok","db":"up"}` — real query against the Neon Postgres instance (DB `CaleSystem`).
- Neon Postgres, Cloudflare R2 bucket `cale-storage` (unused by code yet), Sentry org `xeazharr` with 4 projects created (only `cale-api`'s DSN is wired into this repo's `.env`; `calepos-web`/`-electron`/`-android` DSNs exist in Sentry but aren't in `client` (cale-pos's frontend) yet — no SDK installed there).

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

**Layering rule:** controllers → module services → Drizzle repositories. A module only ever touches its own tables. Cross-module interaction happens through that module's own service/API layer or outbox events — never a direct query into another module's schema. Once schemas exist, this is enforced two ways: code convention (repository layer) and a distinct Postgres role per module granted only on its own schema — see `PLATFORM_SETUP.md` section 3.2 for the exact `CREATE ROLE`/`GRANT` pattern. A code-review miss should never become a runtime hole.

## Versioning

Not yet decided for this repo — `cale-pos/client`'s MAJOR/MINOR-only convention (see its `CLAUDE.md`) is the likely starting point once this ships anything with external behavior, but that hasn't been confirmed for `cale-api` yet. Don't assume it applies here until this section is updated.

## Next steps

Phase 2 of `PLATFORM_SETUP.md` is fully done (repos, accounts, `main.ts` wiring). Next up is Phase 3 — "Build the replacement": snapshot Supabase to a working copy, then write the Drizzle schema module-by-module (`PLATFORM_SETUP.md` 3.2), followed by the auth port (3.3) and porting `client/src/lib/api.js` (3.4). Read `PLATFORM_SETUP.md` Phase 3 in full before starting — it has the exact schema/role/RLS-equivalent pattern this repo needs to follow.

## Security & Fiscal Changes

Canonical list (mirrors `cale-pos/client/CLAUDE.md`): authentication, authorization, RLS, payments, inventory, pricing, refunds, voids, taxes, invoice numbering, audit logs, sales records.

None of these exist as real code in this repo yet. Once they do:
- Treat the database/RLS layer as the security boundary, same as the Supabase-backed app did.
- `SET LOCAL app.current_branch_id` / `app.current_staff_id` must only ever be set inside an explicit transaction on a single connection — see `PLATFORM_SETUP.md` section 3.2, "`SET LOCAL` correctness", for why a bare pooled query is a real cross-branch leak, not a theoretical one.
- A request with no branch context set must be denied, not default-allowed.
- Don't weaken an existing security or fiscal control merely to make a feature easier to implement.
