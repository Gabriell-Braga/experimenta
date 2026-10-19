// Entrada para Cloudflare Workers: D1 no lugar do Postgres, KV como CDN, sessões de edição no D1.
// O servidor Node (src/server.ts) continua sendo o caminho de dev/self-host com Postgres.
import type { D1Database, ExecutionContext, KVNamespace } from '@cloudflare/workers-types';
import { createApp } from './app';
import { hourlyJobs } from './bandit';
import { writeAccountFiles, type CdnStore } from './cdn';
import { createPublisher } from './publish';
import { retentionCutoff } from './repo';
import { createD1Repo, createD1SessionStore, type D1Like } from './repo-d1';
import { seedDev } from './seed';

export interface Env {
  DB: D1Database;
  CDN: KVNamespace;
  JWT_SECRET: string;
  /** Senha dos usuários da conta demo criados no primeiro acesso. */
  SEED_PASSWORD: string;
  PUBLIC_URL: string;
  EDITOR_ORIGINS: string;
  DEMO_SITE_URL: string;
  HEATMAP_SAMPLE_RATE?: string;
  /** Dias de retenção dos eventos crus (0 desliga o expurgo). */
  EVENTS_RETENTION_DAYS?: string;
}

/** KV como CDN. O runtime (abt.js) só muda a cada deploy: fica em memória no isolate. */
function kvStore(kv: KVNamespace): CdnStore {
  let runtime: string | null = null;
  return {
    async get(name) {
      if (name === 'abt.js') return (runtime ??= await kv.get(name));
      return kv.get(name);
    },
    put: (name, body) => kv.put(name, body),
  };
}

let app: ReturnType<typeof createApp> | undefined;
let booting: Promise<ReturnType<typeof createApp>> | undefined;

/** Repositório, CDN e publicador (usados pelo app e pelos jobs agendados). */
function core(env: Env) {
  const repo = createD1Repo(env.DB as unknown as D1Like);
  const cdn = kvStore(env.CDN);
  const publish = createPublisher({
    repo,
    cdn,
    publicUrl: env.PUBLIC_URL,
    heatmapSampleRate: Number(env.HEATMAP_SAMPLE_RATE ?? 1),
  });
  return { repo, cdn, publish };
}

async function build(env: Env) {
  const d1 = env.DB as unknown as D1Like;
  const { repo, cdn, publish } = core(env);
  await seedDev(repo, env.DEMO_SITE_URL, env.SEED_PASSWORD);
  // Config vazia da conta demo até a primeira publicação (o site demo já carrega o script).
  if (!(await cdn.get('demo.json')))
    await writeAccountFiles(cdn, {
      accountId: 'demo',
      version: 1,
      publishedAt: new Date().toISOString(),
      apiUrl: env.PUBLIC_URL,
      trackingUrl: `${env.PUBLIC_URL}/collect`,
      experiments: [],
    });
  return createApp({
    repo,
    cdn,
    editorOrigins: env.EDITOR_ORIGINS.split(','),
    jwtSecret: env.JWT_SECRET,
    sessions: createD1SessionStore(d1),
    publish,
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    app ??= await (booting ??= build(env));
    return app.fetch(req, env, ctx);
  },
  /** Crons (wrangler.jsonc → triggers): de hora em hora bandits e recomendações; às 04:00 UTC, retenção. */
  async scheduled(event: { cron: string }, env: Env) {
    const { repo, cdn, publish } = core(env);
    await hourlyJobs(repo, cdn, publish);
    if (event.cron !== '0 4 * * *') return;
    const cutoff = retentionCutoff(Number(env.EVENTS_RETENTION_DAYS ?? 90));
    if (cutoff) await repo.purgeEventsBefore(cutoff);
  },
};
