import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Observable } from 'rxjs';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from './pg-pool.provider';
import { tenantContext } from './request-context';

interface AuthenticatedRequestUser {
  staffId: string;
  branchId: string;
  role: string;
}

/**
 * FIX-3 (PLATFORM_SETUP.md section 4): the one place that opens a
 * request-scoped transaction and sets RLS context. Route handlers and
 * services must NEVER set app.current_* themselves — a handler that forgets
 * is a silent cross-branch data leak, so there is exactly one place this can
 * go wrong.
 *
 * SET LOCAL only holds for the current transaction on the current
 * connection, so this dedicates one pool client to the whole request
 * lifecycle (BEGIN → set_config → handler runs on that same client via
 * tenantContext → COMMIT/ROLLBACK → release) instead of relying on the
 * shared pooled DRIZZLE_DB, where two statements can silently land on two
 * different connections.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user: AuthenticatedRequestUser | undefined = req.user;

    // No authenticated staff/branch on this request (login, refresh,
    // health) — nothing to scope, run through the shared pool untouched.
    if (!user) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      let client: PoolClient | undefined;
      let finished = false;

      // Idempotent no matter how it's reached: the normal complete/error
      // paths await it, and the teardown below calls it fire-and-forget for
      // an early unsubscribe (e.g. the client disconnecting mid-request).
      const finish = (commit: boolean): Promise<void> => {
        if (finished || !client) return Promise.resolve();
        finished = true;
        const c = client;
        return c
          .query(commit ? 'COMMIT' : 'ROLLBACK')
          .catch(() => undefined)
          .then(() => c.release());
      };

      this.pool
        .connect()
        .then(async (c) => {
          client = c;
          await c.query('BEGIN');
          // Parameterized, transaction-local (set_config's third arg) —
          // never string-build SET LOCAL, per PLATFORM_SETUP.md FIX-3(a).
          await c.query(
            `SELECT set_config('app.current_branch_id', $1, true),
                    set_config('app.current_staff_id', $2, true),
                    set_config('app.current_role', $3, true)`,
            [user.branchId, user.staffId, user.role],
          );
          const db = drizzle(c);

          tenantContext.run(db, () => {
            // Buffered, not forwarded live: the response must never reach
            // the caller before COMMIT has actually run. Forwarding live
            // would let a consumer that unsubscribes right after the first
            // value (e.g. Nest resolving a handler's Observable via
            // firstValueFrom-style consumption) race past the commit and
            // get treated as a rollback instead.
            const buffered: unknown[] = [];
            next.handle().subscribe({
              next: (value) => buffered.push(value),
              error: (err) => {
                finish(false).finally(() => subscriber.error(err));
              },
              complete: () => {
                finish(true).finally(() => {
                  for (const value of buffered) subscriber.next(value);
                  subscriber.complete();
                });
              },
            });
          });
        })
        .catch((err) => {
          finished = true;
          client?.release();
          subscriber.error(err);
        });

      return () => {
        finish(false).catch(() => undefined);
      };
    });
  }
}
