import assert from 'node:assert';
import { LoginRequestSchema, RefreshRequestSchema, AuthTokensSchema } from './auth';

assert.strictEqual(
  LoginRequestSchema.safeParse({
    staffId: '11111111-1111-4111-8111-111111111111',
    branchId: '22222222-2222-4222-8222-222222222222',
    pin: '1234',
  }).success,
  true,
);
assert.strictEqual(
  LoginRequestSchema.safeParse({ staffId: 'not-a-uuid', branchId: '2', pin: '1234' }).success,
  false,
);
assert.strictEqual(
  LoginRequestSchema.safeParse({
    staffId: '11111111-1111-4111-8111-111111111111',
    branchId: '22222222-2222-4222-8222-222222222222',
    pin: '12', // shorter than the 4-char minimum
  }).success,
  false,
);

assert.strictEqual(RefreshRequestSchema.safeParse({ refreshToken: 'abc' }).success, true);
assert.strictEqual(RefreshRequestSchema.safeParse({}).success, false);

assert.strictEqual(
  AuthTokensSchema.safeParse({ accessToken: 'a', refreshToken: 'b', expiresIn: 900 }).success,
  true,
);
assert.strictEqual(
  AuthTokensSchema.safeParse({ accessToken: 'a', refreshToken: 'b' }).success,
  false,
);

console.log('auth contracts self-check passed');
