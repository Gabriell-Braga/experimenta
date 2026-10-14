import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export type Db = PgDatabase<PgQueryResultHKT>;

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Postgres real se `url` existir; senão PGlite (em memória se dataDir for undefined).
 * Aplica as migrações de `apps/api/drizzle` (geradas com `pnpm --filter @abtest/api db:generate`).
 */
export async function createDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const postgres = (await import('postgres')).default;
    const db = drizzle(postgres(opts.url, { onnotice: () => {} }));
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const db = drizzle(new PGlite(opts.dataDir));
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export async function ping(db: Db): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}
