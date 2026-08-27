import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdentityModule } from './identity/identity.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommerceModule } from './commerce/commerce.module';
import { InventoryModule } from './inventory/inventory.module';
import { OpsModule } from './ops/ops.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [IdentityModule, CatalogModule, CommerceModule, InventoryModule, OpsModule, PlatformModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
