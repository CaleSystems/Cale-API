import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './db/pg-pool.provider';

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
}
