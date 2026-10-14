import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createDb } from './db';

const port = Number(process.env.PORT ?? 4000);
const dataDir = process.env.PGLITE_DIR ?? '../../.data/pglite';
if (!process.env.DATABASE_URL) mkdirSync(dataDir, { recursive: true });
const db = await createDb({ url: process.env.DATABASE_URL, dataDir });
serve({ fetch: createApp(db).fetch, port }, () => console.log(`[api] http://localhost:${port}`));
