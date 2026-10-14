import { Hono } from 'hono';
import { ping, type Db } from './db';

export function createApp(db: Db) {
  const app = new Hono();
  app.get('/health', async (c) => c.json({ ok: await ping(db) }));
  return app;
}
