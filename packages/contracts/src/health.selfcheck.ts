import assert from 'node:assert';
import { HealthResponseSchema, DeepHealthReportSchema } from './health';

assert.strictEqual(HealthResponseSchema.safeParse({ status: 'ok', db: 'up' }).success, true);
assert.strictEqual(HealthResponseSchema.safeParse({ status: 'ok', db: 'down' }).success, false);

assert.strictEqual(
  DeepHealthReportSchema.safeParse({
    status: 'ok',
    checks: { database: { status: 'up', latencyMs: 3 } },
  }).success,
  true,
);
assert.strictEqual(
  DeepHealthReportSchema.safeParse({
    status: 'ok',
    checks: { database: { status: 'sideways' } },
  }).success,
  false,
);

console.log('contracts self-check passed');
