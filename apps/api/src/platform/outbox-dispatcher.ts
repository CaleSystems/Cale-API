import { Inject, Injectable } from '@nestjs/common';
// Type-only: erased at compile time, so this never becomes a runtime
// `require('pg-boss')` — see pg-boss.provider.ts for why that would break
// (pg-boss is ESM-only; this app is CommonJS).
import type { PgBoss } from 'pg-boss';
import { PG_BOSS } from './pg-boss.provider';

export interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

// The relay depends on this interface, not on PgBoss directly, so the e2e
// tests below can swap in a stub that records calls / throws on demand
// instead of asserting against real queue state.
export interface OutboxEventDispatcher {
  dispatch(event: OutboxEvent): Promise<void>;
}

export const OUTBOX_DISPATCHER = 'OUTBOX_DISPATCHER';

// No business module produces a real event type yet (PLATFORM_SETUP.md 1c:
// no controller exists to write one) — this dispatcher is still the correct
// generic shape for whenever one does. A pg-boss queue must exist before
// .send() will accept a job for it; rather than pre-declaring every future
// event type here, create it on first use and retry once.
@Injectable()
export class PgBossOutboxDispatcher implements OutboxEventDispatcher {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async dispatch(event: OutboxEvent): Promise<void> {
    try {
      await this.boss.send(event.eventType, event.payload as object);
    } catch (err) {
      if (!(await this.boss.getQueue(event.eventType))) {
        await this.boss.createQueue(event.eventType);
        await this.boss.send(event.eventType, event.payload as object);
        return;
      }
      throw err;
    }
  }
}
