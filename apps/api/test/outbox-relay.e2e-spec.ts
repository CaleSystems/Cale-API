import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AppModule } from '../src/app.module';
import { DRIZZLE_DB } from '../src/db/drizzle.provider';
import {
  OUTBOX_DISPATCHER,
  OutboxEvent,
  OutboxEventDispatcher,
} from '../src/platform/outbox-dispatcher';
import {
  MAX_RETRIES,
  OutboxRelayService,
} from '../src/platform/outbox-relay.service';
import { outbox, outboxDeadLetter } from '../src/platform/platform.schema';

// FIX-1's whole point is that delivery survives concurrent pollers on a
// shared connection pool — so this hits the real Neon DB, same as the other
// e2e specs. A mock DB would hide exactly the race (SKIP LOCKED behaving
// correctly under load) this suite exists to catch.
describe('OutboxRelayService (e2e)', () => {
  let moduleFixture: TestingModule;
  let db: NodePgDatabase;
  let relay: OutboxRelayService;
  let dispatcher: RecordingDispatcher;

  class RecordingDispatcher implements OutboxEventDispatcher {
    calls: OutboxEvent[] = [];
    failNext = 0;
    async dispatch(event: OutboxEvent): Promise<void> {
      this.calls.push(event);
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error('simulated dispatch failure');
      }
    }
  }

  beforeAll(async () => {
    dispatcher = new RecordingDispatcher();
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OUTBOX_DISPATCHER)
      .useValue(dispatcher)
      .compile();
    db = moduleFixture.get(DRIZZLE_DB);
    relay = moduleFixture.get(OutboxRelayService);
  });

  afterAll(async () => {
    await moduleFixture.close();
  });

  beforeEach(() => {
    dispatcher.calls = [];
    dispatcher.failNext = 0;
  });

  async function insertRow(
    overrides: Partial<typeof outbox.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(outbox)
      .values({
        aggregateType: 'test_aggregate',
        aggregateId: '00000000-0000-4000-8000-000000000001',
        eventType: `test.event.${Date.now()}.${Math.random()}`,
        payload: { hello: 'world' },
        ...overrides,
      })
      .returning();
    return row;
  }

  it('dispatches a pending row and marks it processed', async () => {
    const row = await insertRow();

    const claimed = await relay.pollOnce();

    expect(claimed).toBeGreaterThanOrEqual(1);
    expect(dispatcher.calls.some((c) => c.eventType === row.eventType)).toBe(
      true,
    );

    const [after] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(after.processedAt).not.toBeNull();
  });

  it('leaves a future-retryAfter row unclaimed', async () => {
    const future = new Date(Date.now() + 60_000);
    const row = await insertRow({ retryAfter: future });

    await relay.pollOnce();

    expect(dispatcher.calls.some((c) => c.eventType === row.eventType)).toBe(
      false,
    );
    const [after] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(after.processedAt).toBeNull();
  });

  it('backs off with a retry_after on dispatch failure, without dead-lettering early', async () => {
    dispatcher.failNext = 1;
    const row = await insertRow();

    await relay.pollOnce();

    const [after] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(after.processedAt).toBeNull();
    expect(after.retryCount).toBe(1);
    expect(after.retryAfter).not.toBeNull();

    // retryAfter is computed from Postgres's now(), not this machine's clock
    // — comparing it against a local Date.now() would be a flaky
    // cross-machine timestamp comparison. Assert the actual behavior
    // instead: an immediate second poll must not reclaim this row yet.
    dispatcher.calls = [];
    await relay.pollOnce();
    expect(dispatcher.calls.some((c) => c.eventType === row.eventType)).toBe(
      false,
    );
  });

  it('moves a row to the dead letter table once retries exceed the ceiling', async () => {
    dispatcher.failNext = 1;
    const row = await insertRow({ retryCount: MAX_RETRIES });

    await relay.pollOnce();

    const [after] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(after.processedAt).not.toBeNull();

    const [dead] = await db
      .select()
      .from(outboxDeadLetter)
      .where(eq(outboxDeadLetter.outboxId, row.id));
    expect(dead).toBeDefined();
    expect(dead.eventType).toBe(row.eventType);
    expect(dead.failureReason).toContain('simulated dispatch failure');
  });

  it('does not double-dispatch the same row across two concurrent pollers', async () => {
    const rows = await Promise.all([insertRow(), insertRow(), insertRow()]);
    const eventTypes = new Set(rows.map((r) => r.eventType));

    const [claimedA, claimedB] = await Promise.all([
      relay.pollOnce(),
      relay.pollOnce(),
    ]);

    expect(claimedA + claimedB).toBeGreaterThanOrEqual(rows.length);

    for (const type of eventTypes) {
      const callsForRow = dispatcher.calls.filter((c) => c.eventType === type);
      expect(callsForRow.length).toBe(1);
    }
  });
});
