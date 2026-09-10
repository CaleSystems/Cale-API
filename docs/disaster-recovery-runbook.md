# Disaster recovery runbook — cale-api / Neon `CaleSystems`

One page, written to be read while panicking. Last drilled: **2026-09-10** (see log at bottom).

## What backup actually exists today

- **Neon point-in-time recovery (PITR).** Project `CaleSystems` (`delicate-feather-80090508`,
  org `Xeazhar`, Launch plan) has `history_retention_seconds: 21600` — **a 6-hour window.**
  Anything older than 6 hours cannot be PITR-restored. This is short; revisit if the plan or
  setting changes.
- **Manual snapshots**, taken on demand via the Neon API/console (`create_snapshot` on a
  branch). Not scheduled — nothing takes one automatically today.
- **Not yet built:** the nightly `pg_dump` → Cloudflare R2 second copy that
  `PLATFORM_SETUP.md`'s FIX-7 calls for. R2 bucket `cale-storage` exists but nothing in this
  repo writes to it yet. **This means today there is only one copy of the data, held by Neon.**
  A Neon-level incident (not just a bad migration) has no second copy to fall back to. Build
  the nightly dump job before this matters — i.e. before real fiscal data lands (Phase 2).

## Restore procedure (what's actually tested)

1. Identify the target point: a timestamp (PITR, within the 6-hour window) or a manual
   snapshot ID (`list_snapshots`).
2. Restore onto a **new** branch, never directly onto `production`:
   - PITR: `create_branch` with `parent_id` = production's branch ID and a timestamp, or
   - Snapshot: `restore_snapshot` with the snapshot ID, omitting `target_branch_id` (creates
     a fresh branch rather than overwriting anything).
3. Verify data on the new branch before touching anything live — row counts against what you
   expect, spot-check a few rows. Query it directly; don't trust a schema-tree view alone (the
   `describe_branch` tool's tree view under-reported tables that a direct `SELECT count(*)`
   confirmed were present and correct during the 2026-09-10 drill — treat that view as
   orientation, not verification).
4. Only after verification: point `cale-api`'s `DATABASE_URL` at the restored branch (env var
   change + redeploy), or use `finalize_branch_restore` to promote it in place if Neon's own
   restore-in-place flow is being used instead.
5. Never delete the pre-restore state until the incident is confirmed resolved and reviewed.

## What to tell staff while restoring

Not yet applicable in production — `cale-api` has no live traffic; CalePOS is still
Supabase-backed. Once Phase 2 cutover happens, this section needs real content: which branches
are affected, what a cashier sees (a POS able to queue offline sales is not blocked by an API
outage), and who to call.

## How devices re-sync afterwards

Not yet applicable — no device-token sync protocol exists yet (D3, still open). Once it does:
a restore rolls the server back in time, so devices must reconcile via their normal
delta-since-cursor mechanism (FIX-2) rather than assuming their last-synced state is still
correct — the same mechanism a socket drop already has to handle.

## Restore drill log

| Date | Method | Result | Time to ready + queryable |
|---|---|---|---|
| 2026-09-10 | Manual snapshot (`snap-autumn-fire-azif6p8l`) of `production` → restored onto a new throwaway branch via `restore_snapshot` | Verified: all table row counts on the restored branch matched `production` exactly at drill time (`outbox`: 49, `outbox_dead_letter`: 7, all identity tables: 0 — no real data yet) | ~16 seconds from snapshot to a ready, queryable branch |

Numbers above are from Neon's copy-on-write branch/snapshot mechanism, not a `pg_dump`/
`pg_restore` cycle — no `pg_dump` drill has been run yet, and one is only meaningful once the
nightly-dump job above actually exists. Re-run this drill after that job ships, and again once
real data volume exists — restore time at near-zero data size is not evidence for restore time
at production scale.
