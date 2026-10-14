import { defineConfig } from 'vitest/config';

// A suíte roda duas vezes: contra Postgres (PGlite) e contra D1 (SQLite), o banco do deploy na Cloudflare.
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'postgres' } },
      {
        extends: true,
        test: { name: 'd1', env: { REPO: 'd1' }, exclude: ['**/node_modules/**', 'src/conflicts.test.ts'] },
      },
    ],
  },
});
