import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PG_BOSS = 'PG_BOSS';

// pg-boss@12 ships ESM-only ("type": "module" in its package.json), while
// this app compiles to CommonJS. A plain `import`/`require('pg-boss')`
// throws ERR_REQUIRE_ESM at runtime — and TypeScript down-levels an
// ordinary `import()` to `require()` under a commonjs module target too, so
// that doesn't dodge it either. Routing the import through `new Function`
// hides it from TS's downlevel transform, so this really is a native
// dynamic `import()` at runtime, which CommonJS code can use to load an ESM
// module. Narrow, standard workaround — not a reason to move the whole
// build to ESM for one dependency.
const importPgBoss = new Function('return import("pg-boss")') as () => Promise<
  typeof import('pg-boss')
>;

// Constructing PgBoss does not open a connection — only .start() does, and
// only OutboxRelayService calls that, and only under ROLE=worker (FIX-5:
// "the web service never accidentally picks up jobs"). So it's safe for
// this provider to exist unconditionally in every process without costing
// the web service an extra idle connection.
export const pgBossProvider: Provider = {
  provide: PG_BOSS,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const { PgBoss } = await importPgBoss();
    return new PgBoss(config.get<string>('DATABASE_URL')!);
  },
};
