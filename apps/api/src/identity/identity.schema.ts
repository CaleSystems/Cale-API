import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors ../POS/pos-frontend/src/utils/roles.js's five roles. Keep in sync
// if that list ever changes.
export const staffRole = pgEnum('staff_role', [
  'cashier',
  'supervisor',
  'manager',
  'admin',
  'master',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    code: text('code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgCodeUnique: uniqueIndex('branches_org_id_code_key').on(t.orgId, t.code),
  }),
);

// Role lives only on staff_assignments below — PLATFORM_SETUP.md D2/D3 treat
// "who has what role, where, since when" as the source of truth, not a
// denormalized column here. A current role is read as the assignment row
// with valid_to IS NULL.
export const staff = pgTable('staff', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  fullName: text('full_name').notNull(),
  // argon2id, per PLATFORM_SETUP.md's "three Supabase-specific replacements"
  // — replaces Supabase's pgcrypto-encrypted login_pin.
  pinHash: text('pin_hash').notNull(),
  // D3: dismissal-for-cause quarantines writes made under this staff member
  // after this timestamp — it does not delete or reject retroactively valid
  // history.
  revokedForCauseAt: timestamp('revoked_for_cause_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Temporal per PLATFORM_SETUP.md D3 — "was staff_id assigned to branch_id
// holding role at captured_at" must be answerable for any past instant, not
// just the present. valid_to IS NULL means currently active.
export const staffAssignments = pgTable(
  'staff_assignments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    role: staffRole('role').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    staffValidFromIdx: index('staff_assignments_staff_id_valid_from_idx').on(
      t.staffId,
      t.validFrom,
    ),
  }),
);

// Temporal per D3 — a device is registered long-lived to exactly one branch
// and individually revocable. valid_to IS NULL means currently active;
// revokedForCauseAt is separate from valid_to because it makes revocation
// retroactive: mutations captured after it are quarantined, not just future
// syncs blocked.
export const deviceRegistrations = pgTable(
  'device_registrations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    label: text('label').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    revokedForCauseAt: timestamp('revoked_for_cause_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    branchValidFromIdx: index(
      'device_registrations_branch_id_valid_from_idx',
    ).on(t.branchId, t.validFrom),
  }),
);

// A staff session, scoped to one branch chosen at login (role for that
// session is read off the staffAssignments row for that staff+branch, not
// stored again here). refreshTokenHash is argon2id-hashed — the raw token
// only ever exists in the client's hands, never at rest, so a DB leak alone
// can't be replayed into a live session. Lookup is by session id (the JWT's
// `jti`), not by scanning hashes.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    staffIdx: index('sessions_staff_id_idx').on(t.staffId),
  }),
);
