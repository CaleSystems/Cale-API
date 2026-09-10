import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InjectDrizzle } from '../db/drizzle.provider';
import { staff, staffAssignments, sessions } from './identity.schema';

@Injectable()
export class IdentityRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async findStaffById(staffId: string) {
    const [row] = await this.db
      .select()
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    return row ?? null;
  }

  // D3: "current" means the assignment has never been closed out
  // (validTo IS NULL) — role always comes from this row, never a cached copy.
  async findCurrentAssignment(staffId: string, branchId: string) {
    const [row] = await this.db
      .select({ role: staffAssignments.role })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.staffId, staffId),
          eq(staffAssignments.branchId, branchId),
          isNull(staffAssignments.validTo),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createSession(data: {
    id: string;
    staffId: string;
    branchId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }) {
    const [row] = await this.db.insert(sessions).values(data).returning();
    return row;
  }

  async findActiveSessionById(id: string) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .limit(1);
    return row ?? null;
  }

  async rotateSession(
    id: string,
    data: { refreshTokenHash: string; expiresAt: Date },
  ) {
    await this.db.update(sessions).set(data).where(eq(sessions.id, id));
  }

  async revokeSession(id: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id));
  }
}
