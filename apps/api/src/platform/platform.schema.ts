import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// FIX-1 (PLATFORM_SETUP.md section 4): business writes append a row here in
// the SAME transaction as the write they describe — see OutboxService.
// Delivery is a separate, polled concern (OutboxRelayService), never
// LISTEN/NOTIFY (Neon autosuspend kills persistent listener connections).
// bigserial, not uuid: the relay claims in id order, and a sequential id is
// what makes "ORDER BY id" a meaningful FIFO instead of an arbitrary one.
export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // NULL = not yet delivered. Set once the dispatcher call for this row
    // has returned successfully, or once it's been moved to the dead letter
    // table (either way, the relay must stop reclaiming it).
    processedAt: timestamp('processed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    retryAfter: timestamp('retry_after', { withTimezone: true }),
  },
  (t) => ({
    // Matches the relay's claim query exactly (WHERE processed_at IS NULL
    // ORDER BY id) — the whole point is to keep a poll every few seconds
    // cheap even once this table has millions of processed rows in it.
    unprocessedIdx: index('outbox_unprocessed_idx')
      .on(t.id)
      .where(sql`${t.processedAt} IS NULL`),
  }),
);

// A row is copied here (and the original marked processed) once retryCount
// exceeds the relay's ceiling — "moved", per FIX-1, not silently dropped.
export const outboxDeadLetter = pgTable('outbox_dead_letter', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  outboxId: bigint('outbox_id', { mode: 'number' }).notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  retryCount: integer('retry_count').notNull(),
  failureReason: text('failure_reason').notNull(),
  movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
});
