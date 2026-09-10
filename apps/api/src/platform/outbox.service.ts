import { Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { outbox } from './platform.schema';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

// FIX-1: "keep writing events to it inside the same transaction as the
// business write." Callers pass whatever db handle their own write ran on
// (their request-scoped tenant db from FIX-3's getTenantDb(), or a manual
// transaction) — this takes the handle rather than injecting DRIZZLE_DB
// itself, precisely so it can never accidentally run on a different
// connection than the write it's supposed to be atomic with.
@Injectable()
export class OutboxService {
  async enqueue(db: NodePgDatabase, event: OutboxEventInput): Promise<void> {
    await db.insert(outbox).values({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload as object,
    });
  }
}
