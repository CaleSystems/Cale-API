import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DRIZZLE_DB } from '../src/db/drizzle.provider';
import {
  organizations,
  branches,
  staff,
  staffAssignments,
  sessions,
} from '../src/identity/identity.schema';

// Hits the real Neon DB, same as app.e2e-spec.ts — mocking Drizzle here would
// hide exactly the kind of bug (a bad join, a wrong enum value) this schema
// is supposed to catch.
describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let db: NodePgDatabase;
  let orgId: string;
  let branchId: string;
  let staffId: string;
  const pin = '1234';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    db = moduleFixture.get(DRIZZLE_DB);

    const [org] = await db
      .insert(organizations)
      .values({ name: 'E2E Test Org' })
      .returning();
    orgId = org.id;

    const [branch] = await db
      .insert(branches)
      .values({ orgId, name: 'E2E Branch', code: `e2e-${Date.now()}` })
      .returning();
    branchId = branch.id;

    const pinHash = await argon2.hash(pin, { type: argon2.argon2id });
    const [staffRow] = await db
      .insert(staff)
      .values({ orgId, fullName: 'E2E Cashier', pinHash })
      .returning();
    staffId = staffRow.id;

    await db
      .insert(staffAssignments)
      .values({ staffId, branchId, role: 'cashier' });
  });

  afterAll(async () => {
    await db.delete(sessions).where(eq(sessions.staffId, staffId));
    await db
      .delete(staffAssignments)
      .where(eq(staffAssignments.staffId, staffId));
    await db.delete(staff).where(eq(staff.id, staffId));
    await db.delete(branches).where(eq(branches.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await app.close();
  });

  it('rejects a wrong PIN', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ staffId, branchId, pin: 'wrong' })
      .expect(401);
  });

  it('rejects login for a branch the staff has no current assignment at', async () => {
    const [otherBranch] = await db
      .insert(branches)
      .values({
        orgId,
        name: 'Other Branch',
        code: `e2e-other-${Date.now()}`,
      })
      .returning();

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ staffId, branchId: otherBranch.id, pin })
      .expect(401);
  });

  it('logs in, refreshes (rotating the token), rejects replay, then logs out', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ staffId, branchId, pin })
      .expect(200);

    expect(loginRes.body.accessToken).toEqual(expect.any(String));
    expect(loginRes.body.refreshToken).toEqual(expect.any(String));

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);

    expect(refreshRes.body.accessToken).toEqual(expect.any(String));

    // The old refresh token was rotated out by the refresh above — replaying
    // it is either a bug or an attacker; either way it must fail.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .expect(204);

    // The now-current refresh token belongs to a session logout just revoked.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });
});
