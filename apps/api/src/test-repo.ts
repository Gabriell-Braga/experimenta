// Repositório para os testes: Postgres (PGlite) por padrão, ou D1 (SQLite via node:sqlite) com REPO=d1.
// A mesma suíte roda contra as duas implementações (vitest.config.ts).
import { readFileSync } from 'node:fs';
import { createDb } from './db';
import { createRepo, type Repo } from './repo';
import { createD1Repo, type D1Like, type D1Stmt } from './repo-d1';

/** Imita a API do D1 sobre node:sqlite (síncrono por baixo). */
export async function nodeD1(): Promise<D1Like> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations-d1/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export async function testRepo(): Promise<Repo> {
  return process.env.REPO === 'd1' ? createD1Repo(await nodeD1()) : createRepo(await createDb());
}
