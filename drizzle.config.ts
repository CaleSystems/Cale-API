import type { Config } from 'drizzle-kit';

// No schema files exist yet — `src/**/*.schema.ts` is the convention the
// module layout expects, one schema file per module, never crossing modules.
export default {
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL as string },
} satisfies Config;
