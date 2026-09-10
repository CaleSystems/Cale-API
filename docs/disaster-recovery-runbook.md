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

> **`restore_snapshot`'s `finalize` flag defaults to `true` when you omit `target_branch_id`.**
> Learned the hard way during the 2026-09-10 drill below: that default does **not** mean "create
> a harmless side copy." It reassigns the real compute endpoint(s) onto the restored branch and
> swaps branch names so the restored branch *becomes* `production` — the pre-restore branch
> survives, but renamed and demoted, not deleted. If you want a passive copy to inspect before
> committing to anything, pass **`finalize: false`** explicitly, inspect on the side branch, and
> only call `finalize_branch_restore` once you've actually decided to cut over. Skipping that
> flag is what turned this rehearsal into a real (safe, but unintended) restore-in-place.

1. Identify the target point: a timestamp (PITR, within the 6-hour window) or a manual
   snapshot ID (`list_snapshots`).
2. Restore with `restore_snapshot`, **passing `finalize: false` explicitly** unless you have
   already decided this is a real cutover, not a rehearsal.
3. Verify data on the resulting branch before touching anything live — row counts against what
   you expect, spot-check a few rows. Query it directly; don't trust a schema-tree view alone
   (the `describe_branch` tool's tree view under-reported tables that a direct `SELECT
   count(*)` confirmed were present and correct during the 2026-09-10 drill — treat that view as
   orientation, not verification).
4. Only after verification, and only if this is a real cutover: call `finalize_branch_restore`
   (or point `cale-api`'s `DATABASE_URL` at the branch directly instead, if you'd rather not
   touch which branch is "default" at all).
5. Never delete the pre-restore branch until the incident is confirmed resolved and reviewed —
   it survives the swap under a new name precisely so this stays possible.

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
| 2026-09-10 | Manual snapshot (`snap-autumn-fire-azif6p8l`) of `production` → `restore_snapshot`, `target_branch_id` omitted | Row counts matched exactly (`outbox`: 49, `outbox_dead_letter`: 7, all identity tables: 0 — no real data yet). **Turned out to be a real restore-in-place, not a side rehearsal** — see warning above; `finalize` defaulted to `true`, so it reassigned the live compute endpoint onto the restored branch and renamed it to `production`, demoting the pre-restore branch to `restore-drill-verify-2026-09-10 (1)` rather than deleting it. No data loss (content was identical), but it did restart the production compute — a non-event only because there's no live traffic yet. Corrected after the fact: the old branch (`restore-drill-verify-2026-09-10 (1)`, id `br-old-cloud-az66h7nd`) was kept as a safety copy, confirmed harmless, then deleted by hand via the Neon console once confirmed safe (an automated delete attempt had been blocked by this session's own tooling permissions, unrelated to Neon — the manual deletion is what actually closed this out). The 49/7 stale e2e-test rows were cleared from `outbox`/`outbox_dead_letter` on the (now live) `production` branch the same day, and the e2e suite that was leaking them (`outbox-relay.e2e-spec.ts`) was fixed to clean up its own rows in `afterAll`, so this can't reaccumulate. Project now holds exactly one branch (`production`), confirmed via `list_branches`. | ~16 seconds from snapshot to a ready, queryable branch |

Numbers above are from Neon's copy-on-write branch/snapshot mechanism, not a `pg_dump`/
`pg_restore` cycle — no `pg_dump` drill has been run yet, and one is only meaningful once the
nightly-dump job above actually exists. Re-run this drill after that job ships, and again once
real data volume exists — restore time at near-zero data size is not evidence for restore time
at production scale. Next drill: use `finalize: false` per the warning above, so a rehearsal
can no longer accidentally become a live cutover.
