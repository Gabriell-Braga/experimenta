import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { writeAccountFiles } from './cdn';
import { fsCdnStore, syncBundles } from './cdn-fs';
import { createDb } from './db';
import { createPublisher } from './publish';
import { createRepo } from './repo';
import { seedDev } from './seed';

const repoRoot = resolve(import.meta.dirname, '../../..');
const port = Number(process.env.PORT ?? 4000);
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
const cdnDir = resolve(repoRoot, process.env.CDN_DIR ?? 'cdn');
const editorOrigins = (process.env.EDITOR_ORIGINS ?? 'http://localhost:5173').split(',');

const dataDir = process.env.PGLITE_DIR ?? join(repoRoot, '.data/pglite');
if (!process.env.DATABASE_URL && !dataDir.startsWith('memory://')) mkdirSync(dataDir, { recursive: true });
const db = await createDb({ url: process.env.DATABASE_URL, dataDir });

// CDN local (dev): copia os bundles compilados, recompila as configs já publicadas com o runtime atual
// e cria a config vazia da conta demo até a primeira publicação.
syncBundles(cdnDir, repoRoot);
const cdn = fsCdnStore(cdnDir);
if (existsSync(join(cdnDir, 'abt.js'))) {
  for (const f of readdirSync(cdnDir).filter((f) => f.endsWith('.json')))
    await writeAccountFiles(cdn, JSON.parse(readFileSync(join(cdnDir, f), 'utf8')));
  if (!existsSync(join(cdnDir, 'demo.json')))
    await writeAccountFiles(cdn, {
      accountId: 'demo',
      version: 1,
      publishedAt: new Date().toISOString(),
      apiUrl: publicUrl,
      trackingUrl: `${publicUrl}/collect`,
      experiments: [],
    });
}

const repo = createRepo(db);
if (process.env.NODE_ENV !== 'production') await seedDev(repo);
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao';
if (!process.env.JWT_SECRET)
  console.warn('[api] JWT_SECRET não definido — usando segredo de desenvolvimento');

// ponytail: amostragem global por env; vira configuração por conta quando houver tela de conta.
const publish = createPublisher({
  repo,
  cdn,
  publicUrl,
  heatmapSampleRate: Number(process.env.HEATMAP_SAMPLE_RATE ?? 1),
});

serve({ fetch: createApp({ repo, cdn, editorOrigins, jwtSecret, publish }).fetch, port }, () =>
  console.log(`[api] ${publicUrl} (cdn: ${cdnDir})`),
);
