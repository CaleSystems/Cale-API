import { Test, TestingModule } from '@nestjs/testing';
import type { PgBoss } from 'pg-boss';
import { AppModule } from '../src/app.module';
import {
  OUTBOX_DISPATCHER,
  PgBossOutboxDispatcher,
} from '../src/platform/outbox-dispatcher';
import { PG_BOSS } from '../src/platform/pg-boss.provider';

// The relay's own e2e suite stubs OUTBOX_DISPATCHER entirely, so it never
// exercises this class. This is the one place that does: real pg-boss,
// against the real Neon DB, including the auto-create-queue-on-first-use
// fallback (a queue must exist before .send() accepts a job for it, and
// nothing pre-declares queues for event types that don't exist yet).
describe('PgBossOutboxDispatcher (e2e)', () => {
  let moduleFixture: TestingModule;
  let boss: PgBoss;
  let dispatcher: PgBossOutboxDispatcher;
  const eventType = `test.dispatch.${Date.now()}.${Math.random()}`;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    boss = moduleFixture.get(PG_BOSS);
    await boss.start();
    dispatcher = moduleFixture.get(OUTBOX_DISPATCHER) as PgBossOutboxDispatcher;
  });

  afterAll(async () => {
    if (!boss) return;
    await boss.deleteQueue(eventType).catch(() => undefined);
    await boss.stop({ graceful: false });
    await moduleFixture.close();
  });

  it('creates the queue on first use and sends the job', async () => {
    expect(await boss.getQueue(eventType)).toBeNull();

    await dispatcher.dispatch({
      aggregateType: 'test_aggregate',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      eventType,
      payload: { hello: 'world' },
    });

    expect(await boss.getQueue(eventType)).not.toBeNull();
    const jobs = await boss.fetch(eventType, { batchSize: 10 });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
  });

  it('sends directly once the queue already exists', async () => {
    await dispatcher.dispatch({
      aggregateType: 'test_aggregate',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      eventType,
      payload: { second: true },
    });

    const jobs = await boss.fetch(eventType, { batchSize: 10 });
    expect(jobs.some((j) => (j.data as { second?: boolean }).second)).toBe(
      true,
    );
  });
});
