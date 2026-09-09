import { Global, Module } from '@nestjs/common';
import { drizzleProvider, DRIZZLE_DB } from './drizzle.provider';
import { pgPoolProvider, PG_POOL } from './pg-pool.provider';

// Global so every feature module can @Inject(DRIZZLE_DB) without importing
// this module itself — see https://docs.nestjs.com/modules#global-modules.
// Only AppModule needs to import it. Keep PG_POOL/DRIZZLE_DB provisioned
// here and nowhere else — a second module providing pgPoolProvider would
// open a second connection pool.
@Global()
@Module({
  providers: [pgPoolProvider, drizzleProvider],
  exports: [PG_POOL, DRIZZLE_DB],
})
export class DbModule {}
