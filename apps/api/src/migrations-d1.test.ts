import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Produção (D1) já tem usuários: a migração da 16.2 precisa levar o papel de cada um para memberships.
test('D1 0007: usuários existentes viram membros da sua conta com o mesmo papel', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations-d1/', import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const run = (f: string) => db.exec(readFileSync(new URL(f, dir), 'utf8'));
  files.filter((f) => f < '0007').forEach(run);
  db.exec(`INSERT INTO accounts (id, name, created_at) VALUES ('a', 'A', 1);
    INSERT INTO users (id, account_id, email, name, role, can_publish_js, password_hash, created_at)
    VALUES ('u1', 'a', 'o@a.com', 'O', 'owner', 1, 'h', 1), ('u2', 'a', 'v@a.com', 'V', 'viewer', 0, 'h', 2);`);
  files.filter((f) => f >= '0007').forEach(run);
  expect(db.prepare('SELECT * FROM memberships ORDER BY user_id').all()).toEqual([
    { account_id: 'a', user_id: 'u1', role: 'owner', can_publish_js: 1, created_at: 1 },
    { account_id: 'a', user_id: 'u2', role: 'viewer', can_publish_js: 0, created_at: 2 },
  ]);
  expect(Object.keys(db.prepare('SELECT * FROM users').get() as object)).not.toContain('role');
});
