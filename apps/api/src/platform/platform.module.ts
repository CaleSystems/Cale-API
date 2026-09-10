import { Module } from '@nestjs/common';
import { OUTBOX_DISPATCHER, PgBossOutboxDispatcher } from './outbox-dispatcher';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxService } from './outbox.service';
import { pgBossProvider } from './pg-boss.provider';

@Module({
  providers: [
    pgBossProvider,
    { provide: OUTBOX_DISPATCHER, useClass: PgBossOutboxDispatcher },
    OutboxService,
    OutboxRelayService,
  ],
  exports: [OutboxService],
})
export class PlatformModule {}
