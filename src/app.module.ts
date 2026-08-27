import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Pool } from 'pg';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PG_POOL, pgPoolProvider } from './db/pg-pool.provider';
import { IdentityModule } from './identity/identity.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommerceModule } from './commerce/commerce.module';
import { InventoryModule } from './inventory/inventory.module';
import { OpsModule } from './ops/ops.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    IdentityModule,
    CatalogModule,
    CommerceModule,
    InventoryModule,
    OpsModule,
    PlatformModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    pgPoolProvider,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
