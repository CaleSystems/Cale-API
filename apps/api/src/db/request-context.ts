import { AsyncLocalStorage } from 'node:async_hooks';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Populated per-request by TenantContextInterceptor once app.current_branch_id
// / app.current_staff_id / app.current_role are set on a dedicated
// transaction — see PLATFORM_SETUP.md's FIX-3. Nothing else may populate this.
export const tenantContext = new AsyncLocalStorage<NodePgDatabase>();

// RLS-scoped repositories use this instead of the pooled DRIZZLE_DB so their
// queries run on the same connection/transaction the branch context was set
// on. Throws rather than silently falling back to the ungated pool — a
// request with no context set must be denied, not default-allowed.
export function getTenantDb(): NodePgDatabase {
  const db = tenantContext.getStore();
  if (!db) {
    throw new Error(
      'getTenantDb() called outside TenantContextInterceptor scope — the ' +
        'route is missing JwtAuthGuard, or ran before it in the pipeline',
    );
  }
  return db;
}
