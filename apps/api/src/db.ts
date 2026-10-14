import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export type Db = PgDatabase<PgQueryResultHKT>;

/** Postgres real se DATABASE_URL existir; senão PGlite (em memória se dataDir for undefined). */
export async function createDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    return drizzle(postgres(opts.url)) as unknown as Db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  return drizzle(new PGlite(opts.dataDir)) as unknown as Db;
}

export async function ping(db: Db): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}
