import { expect, test } from 'vitest';
import { createApp } from './app';
import { createDb } from './db';

test('GET /health responde ok com PGlite em memória', async () => {
  const app = createApp(await createDb());
  const res = await app.request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
