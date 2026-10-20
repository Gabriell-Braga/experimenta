import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { compatFromEnv } from './ai';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { hourlyJobs } from './bandit';
import { writeAccountFiles } from './cdn';
import { fsCdnStore, syncBundles } from './cdn-fs';
import { createDb } from './db';
import { createPublisher } from './publish';
import { createRepo, retentionCutoff } from './repo';
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

// Padrão do servidor; cada conta pode sobrescrever (D-038).
const publish = createPublisher({
  repo,
  cdn,
  publicUrl,
  heatmapSampleRate: Number(process.env.HEATMAP_SAMPLE_RATE ?? 1),
});

// Retenção dos eventos crus: expurgo ao subir e a cada 24 h (EVENTS_RETENTION_DAYS, 0 desliga).
const purge = () => {
  const cutoff = retentionCutoff(Number(process.env.EVENTS_RETENTION_DAYS ?? 90));
  if (cutoff) repo.purgeEventsBefore(cutoff).catch((e) => console.error('[api] expurgo de eventos', e));
};
purge();
setInterval(purge, 86_400_000).unref();
// Bandits: pesos recalculados de hora em hora (D-054).
setInterval(
  () => void hourlyJobs(repo, cdn, publish).catch((e) => console.error('[api] jobs', e)),
  3_600_000,
).unref();

serve(
  {
    fetch: createApp({
      repo,
      cdn,
      editorOrigins,
      jwtSecret,
      publish,
      // Ideias de teste com Claude só quando há chave (sem ela, as regras dos insights).
      ai: process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined,
      aiCompat: compatFromEnv(process.env),
    }).fetch,
    port,
  },
  () => console.log(`[api] ${publicUrl} (cdn: ${cdnDir})`),
);
