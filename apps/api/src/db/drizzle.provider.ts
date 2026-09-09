import { Inject, Provider } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PG_POOL } from './pg-pool.provider';

export const DRIZZLE_DB = 'DRIZZLE_DB';

// Wraps the existing PG_POOL — one pool, shared between the raw health-check
// queries and every module's Drizzle repositories. Do not open a second pool.
export const drizzleProvider: Provider = {
  provide: DRIZZLE_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): NodePgDatabase => drizzle(pool),
};

export const InjectDrizzle = () => Inject(DRIZZLE_DB);
