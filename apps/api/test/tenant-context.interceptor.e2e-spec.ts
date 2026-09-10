import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom, Observable, of } from 'rxjs';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db/pg-pool.provider';
import { TenantContextInterceptor } from '../src/db/tenant-context.interceptor';
import { getTenantDb } from '../src/db/request-context';
import { organizations } from '../src/identity/identity.schema';

// FIX-3's whole point is that RLS context lives on one dedicated connection
// per request, not the shared pool — so this hits the real Neon DB, same as
// the other e2e specs. A mock pool would hide exactly the bug (context
// bleeding across pooled connections) this interceptor exists to prevent.
describe('TenantContextInterceptor (e2e)', () => {
  let moduleFixture: TestingModule;
  let pool: Pool;
  let interceptor: TenantContextInterceptor;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    pool = moduleFixture.get(PG_POOL);
    interceptor = new TenantContextInterceptor(pool);
  });

  afterAll(async () => {
    await moduleFixture.close();
  });

  function contextFor(user?: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  function handlerOf(fn: () => Observable<unknown>): CallHandler {
    return { handle: fn };
  }

  it('passes an unauthenticated request through untouched', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        contextFor(undefined),
        handlerOf(() => of('ok')),
      ),
    );
    expect(result).toBe('ok');
  });

  it('getTenantDb() throws outside interceptor scope', () => {
    expect(() => getTenantDb()).toThrow(/outside TenantContextInterceptor/);
  });

  it('sets app.current_branch_id/staff_id/role on the request-scoped transaction', async () => {
    const user = {
      branchId: 'b6f9b6a0-0000-4000-8000-000000000001',
      staffId: 's6f9b6a0-0000-4000-8000-000000000002',
      role: 'cashier',
    };

    const result = await firstValueFrom(
      interceptor.intercept(
        contextFor(user),
        handlerOf(() => {
          const db = getTenantDb();
          return new Observable((subscriber) => {
            db.execute(
              `SELECT current_setting('app.current_branch_id', true) AS branch_id,
                      current_setting('app.current_staff_id', true) AS staff_id,
                      current_setting('app.current_role', true) AS role`,
            )
              .then((res) => {
                subscriber.next(res.rows[0]);
                subscriber.complete();
              })
              .catch((err: unknown) => subscriber.error(err));
          });
        }),
      ),
    );

    expect(result).toEqual({
      branch_id: user.branchId,
      staff_id: user.staffId,
      role: user.role,
    });
  });

  it('commits the transaction when the handler completes normally', async () => {
    const name = `fix3-commit-${Date.now()}`;
    const user = { branchId: 'b0', staffId: 's0', role: 'cashier' };

    await firstValueFrom(
      interceptor.intercept(
        contextFor(user),
        handlerOf(() => {
          const db = getTenantDb();
          return new Observable((subscriber) => {
            db.insert(organizations)
              .values({ name })
              .then(() => {
                subscriber.next(undefined);
                subscriber.complete();
              })
              .catch((err: unknown) => subscriber.error(err));
          });
        }),
      ),
    );

    const rows = await pool.query(
      'SELECT id FROM organizations WHERE name = $1',
      [name],
    );
    expect(rows.rowCount).toBe(1);
    await pool.query('DELETE FROM organizations WHERE name = $1', [name]);
  });

  it('rolls back the transaction when the handler errors', async () => {
    const name = `fix3-rollback-${Date.now()}`;
    const user = { branchId: 'b0', staffId: 's0', role: 'cashier' };

    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextFor(user),
          handlerOf(() => {
            const db = getTenantDb();
            return new Observable((subscriber) => {
              db.insert(organizations)
                .values({ name })
                .then(() => subscriber.error(new Error('boom')))
                .catch((err: unknown) => subscriber.error(err));
            });
          }),
        ),
      ),
    ).rejects.toThrow('boom');

    const rows = await pool.query(
      'SELECT id FROM organizations WHERE name = $1',
      [name],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('does not leak branch context between two interleaved requests on the shared pool', async () => {
    // FIX-6: "write one integration test that proves context does not leak
    // between two interleaved transactions on the same pooled connection."
    const userA = { branchId: 'branch-A', staffId: 'staff-A', role: 'cashier' };
    const userB = { branchId: 'branch-B', staffId: 'staff-B', role: 'manager' };

    const readBranchId = () =>
      new Observable((subscriber) => {
        const db = getTenantDb();
        // Yield to the event loop so the two requests genuinely interleave
        // instead of one finishing before the other starts.
        setTimeout(() => {
          db.execute(
            `SELECT current_setting('app.current_branch_id', true) AS branch_id`,
          )
            .then((res) => {
              subscriber.next((res.rows[0] as { branch_id: string }).branch_id);
              subscriber.complete();
            })
            .catch((err: unknown) => subscriber.error(err));
        }, 20);
      });

    const [resultA, resultB] = await Promise.all([
      firstValueFrom(
        interceptor.intercept(contextFor(userA), handlerOf(readBranchId)),
      ),
      firstValueFrom(
        interceptor.intercept(contextFor(userB), handlerOf(readBranchId)),
      ),
    ]);

    expect(resultA).toBe(userA.branchId);
    expect(resultB).toBe(userB.branchId);
  });
});
