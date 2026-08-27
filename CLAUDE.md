# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cale-api` — the standalone NestJS backend for the Cale platform, replacing Supabase as CalePOS's backend. See `../POS/PLATFORM_SETUP.md` for the full migration plan (this repo is Phase 2 onward of that plan) and the architecture review artifact it links for the decision-by-decision rationale: https://claude.ai/code/artifact/9a543290-9875-453f-ac06-e5c1047f0a36

**Status (2026-08-28): skeleton only.** Module folders exist as empty Nest modules; no schema, no auth, no endpoints beyond the CLI-generated `GET /` yet. Do not assume any of the stack below is wired up — check the actual module contents before relying on this doc's description of intended shape.

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS + TypeScript |
| HTTP adapter | Fastify (`@nestjs/platform-fastify` installed, not yet wired into `main.ts`) |
| API | REST, intended at `/api/v1`, OpenAPI/Swagger (`@nestjs/swagger` installed) |
| Database | Standalone PostgreSQL, schemas per domain, hosted on Neon (not yet provisioned) |
| ORM | Drizzle (`drizzle-orm` + `drizzle-kit` installed, no schema written yet) |
| Auth | In-house — `@nestjs/passport` + `@nestjs/jwt` wrapping argon2id hashing, Postgres-tracked sessions (not yet implemented) |
| Validation | `class-validator` + `class-transformer`, global `ValidationPipe` (not yet wired) |
| Rate limiting | `@nestjs/throttler` (installed, not yet wired) |
| Testing | Jest (unit) + Nest's e2e runner + `supertest` |
| Background jobs | `pg-boss` (installed, not yet used) |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` (installed, not yet used) |

## Commands

```bash
npm install
npm run start:dev   # local dev server
npm run build        # production build
npm test              # unit tests (Jest)
npm run test:e2e     # e2e tests (Nest + supertest)
npm run lint           # ESLint
```

No database is configured yet — none of the modules currently touch Postgres, so these commands work with no external services running.

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

Not yet decided for this repo — `pos-frontend`'s MAJOR/MINOR-only convention (see its `CLAUDE.md`) is the likely starting point once this ships anything with external behavior, but that hasn't been confirmed for `cale-api` yet. Don't assume it applies here until this section is updated.

## Security & Fiscal Changes

Canonical list (mirrors `pos-frontend/CLAUDE.md`): authentication, authorization, RLS, payments, inventory, pricing, refunds, voids, taxes, invoice numbering, audit logs, sales records.

None of these exist as real code in this repo yet. Once they do:
- Treat the database/RLS layer as the security boundary, same as the Supabase-backed app did.
- `SET LOCAL app.current_branch_id` / `app.current_staff_id` must only ever be set inside an explicit transaction on a single connection — see `PLATFORM_SETUP.md` section 3.2, "`SET LOCAL` correctness", for why a bare pooled query is a real cross-branch leak, not a theoretical one.
- A request with no branch context set must be denied, not default-allowed.
- Don't weaken an existing security or fiscal control merely to make a feature easier to implement.
