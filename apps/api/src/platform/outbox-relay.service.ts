import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
// Type-only — see pg-boss.provider.ts for why a value import breaks (ESM-only
// package, CommonJS build).
import type { PgBoss } from 'pg-boss';
import { InjectDrizzle } from '../db/drizzle.provider';
import { OUTBOX_DISPATCHER, OutboxEventDispatcher } from './outbox-dispatcher';
import { PG_BOSS } from './pg-boss.provider';
import { outbox, outboxDeadLetter } from './platform.schema';

// FIX-1's own SQL example runs every 2-5s — well under cron's one-minute
// granularity, so this is a plain interval rather than pg-boss's
// schedule()/cron feature. pg-boss is still what carries the actual
// delivery (OutboxEventDispatcher), just not the polling clock.
// ponytail: fixed interval, not adaptive to queue depth — revisit if the
// outbox ever backs up faster than a 100-row batch every 3s can drain.
const POLL_INTERVAL_MS = 3000;
const BATCH_SIZE = 100;
// Exported so tests assert the dead-letter ceiling against this value
// directly, instead of a duplicated magic number that could drift silently.
export const MAX_RETRIES = 5;

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    @Inject(OUTBOX_DISPATCHER)
    private readonly dispatcher: OutboxEventDispatcher,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // FIX-5: consumers run only under ROLE=worker — the web service must
    // never pick up jobs, even by accident. This also means the web
    // service never calls boss.start(), so it never opens pg-boss's own
    // management connection or touches its schema.
    if (this.config.get<string>('ROLE') !== 'worker') return;
    await this.boss.start();
    this.timer = setInterval(() => {
      this.pollOnce().catch((err) =>
        this.logger.error(
          'outbox poll failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    }, POLL_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.config.get<string>('ROLE') === 'worker') await this.boss.stop();
  }

  // Returns the number of rows claimed, so tests can assert on it directly
  // instead of re-querying the table.
  async pollOnce(): Promise<number> {
    return this.db.transaction(async (tx) => {
      // FOR UPDATE SKIP LOCKED only protects against a second, concurrent
      // poller while the lock is held — which is only for the lifetime of
      // this transaction. Claim and process must therefore happen in the
      // same transaction, not a claim-then-separately-update pattern.
      const rows = await tx
        .select()
        .from(outbox)
        .where(
          and(
            isNull(outbox.processedAt),
            or(isNull(outbox.retryAfter), lte(outbox.retryAfter, sql`now()`)),
          ),
        )
        .orderBy(asc(outbox.id))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      for (const row of rows) {
        try {
          await this.dispatcher.dispatch({
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            eventType: row.eventType,
            payload: row.payload,
          });
          await tx
            .update(outbox)
            .set({ processedAt: new Date() })
            .where(eq(outbox.id, row.id));
        } catch (err) {
          await this.handleFailure(tx, row, err);
        }
      }

      return rows.length;
    });
  }

  private async handleFailure(
    tx: NodePgDatabase,
    row: typeof outbox.$inferSelect,
    err: unknown,
  ): Promise<void> {
    const nextRetryCount = row.retryCount + 1;
    if (nextRetryCount > MAX_RETRIES) {
      // "Moved", per FIX-1 — not silently dropped. Sentry isn't wired into
      // this app yet (cale-api/CLAUDE.md), so this Logger.error call is the
      // interim alert path; swap for a real Sentry capture once that lands.
      this.logger.error(
        `outbox event ${row.id} (${row.eventType}) dead-lettered after ${row.retryCount} retries`,
        err instanceof Error ? err.stack : String(err),
      );
      await tx.insert(outboxDeadLetter).values({
        outboxId: row.id,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: row.payload,
        retryCount: row.retryCount,
        failureReason: err instanceof Error ? err.message : String(err),
      });
      await tx
        .update(outbox)
        .set({ processedAt: new Date() })
        .where(eq(outbox.id, row.id));
      return;
    }

    // Exponential backoff, capped at 5 minutes — a dependency that's down
    // for an hour shouldn't get hammered every 3 seconds until it recovers.
    const backoffSeconds = Math.min(2 ** nextRetryCount, 300);
    await tx
      .update(outbox)
      .set({
        retryCount: nextRetryCount,
        retryAfter: sql`now() + make_interval(secs => ${backoffSeconds})`,
      })
      .where(eq(outbox.id, row.id));
  }
}
