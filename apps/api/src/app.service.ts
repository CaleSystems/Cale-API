import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './db/pg-pool.provider';

export type CheckStatus = 'up' | 'down' | 'not_configured';

export interface HealthCheck {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

export interface DeepHealthReport {
  status: 'ok' | 'error';
  checks: Record<string, HealthCheck>;
}

@Injectable()
export class AppService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkDbHealth(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deep health per FIX-8 — for humans and alerting, not for the load
   * balancer (that polls the shallow `/health`).
   *
   * Dependencies that are not wired yet report `not_configured` and do NOT
   * fail the check. Reporting an unbuilt dependency as healthy would make this
   * endpoint lie; failing on it would make it permanently red. Replace each
   * with a real probe as it lands — R2 when object storage is wired.
   */
  async deepHealth(): Promise<DeepHealthReport> {
    const checks: Record<string, HealthCheck> = {
      database: await this.probeDatabase(),
      storage: { status: 'not_configured', detail: 'R2 not wired yet' },
      outbox: await this.probeOutbox(),
    };

    const failed = Object.values(checks).some((c) => c.status === 'down');
    return { status: failed ? 'error' : 'ok', checks };
  }

  private async probeDatabase(): Promise<HealthCheck> {
    const started = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  // 'down' here means the table isn't reachable — a growing pending count
  // or any dead-lettered rows are a business/alerting concern (FIX-8: "Wire
  // alerts for ... outbox dead-letter arrivals"), not an endpoint failure,
  // so they're surfaced via `detail` rather than flipping this to 'down'.
  private async probeOutbox(): Promise<HealthCheck> {
    const started = Date.now();
    try {
      const result = await this.pool.query<{
        pending: string;
        dead_lettered: string;
      }>(
        `SELECT
           (SELECT count(*) FROM outbox WHERE processed_at IS NULL) AS pending,
           (SELECT count(*) FROM outbox_dead_letter) AS dead_lettered`,
      );
      const { pending, dead_lettered } = result.rows[0];
      return {
        status: 'up',
        latencyMs: Date.now() - started,
        detail: `${pending} pending, ${dead_lettered} dead-lettered`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
