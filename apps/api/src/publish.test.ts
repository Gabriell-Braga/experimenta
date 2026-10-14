import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublishedConfigSchema } from '@abtest/shared';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app';
import { createDb, type Db } from './db';
import { createPublisher } from './publish';
import { createRepo, type Repo } from './repo';
import { DEMO, seedDev } from './seed';

const APP = 'http://localhost:5173';
let db: Db;
let repo: Repo;
let cdnDir: string;
let app: ReturnType<typeof createApp>;
let projectId: string;
const tokens: Record<string, string> = {};

const call = (path: string, as: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { origin: APP, authorization: `Bearer ${tokens[as]}`, 'content-type': 'application/json' },
  });

const exp = (id: string, status: string, customJS = '') => ({
  projectId,
  editorUrl: 'http://localhost:5180/',
  experiment: {
    id,
    key: id.replace('_', '-'),
    name: id,
    status,
    variations: [
      { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
      {
        id: `${id}_v1`,
        key: 'b',
        name: 'B',
        weight: 50,
        customJS,
        operations: [
          { id: 'o1', order: 0, type: 'setText', target: { selector: 'h1' }, value: '<b>Oi</b></script>' },
        ],
      },
    ],
  },
});
const save = (as: string, body: ReturnType<typeof exp>) =>
  call(`/experiments/${body.experiment.id}`, as, { method: 'PUT', body: JSON.stringify(body) });

beforeAll(async () => {
  db = await createDb();
  repo = createRepo(db);
  await seedDev(repo);
  cdnDir = mkdtempSync(join(tmpdir(), 'abt-pub-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
  const publish = createPublisher({ repo, cdnDir, publicUrl: 'https://api.abtest.dev' });
  app = createApp({ db, repo, cdnDir, editorOrigins: [APP], jwtSecret: 's', publish });
  for (const [who, cred] of Object.entries({ owner: DEMO.owner, editor: DEMO.editor, viewer: DEMO.viewer })) {
    const r = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cred),
    });
    tokens[who] = ((await r.json()) as { token: string }).token;
  }
  projectId = (await repo.listProjects(DEMO.accountId))[0]!.id;
});

describe('publicação', () => {
  test('compila só experimentos em execução, versiona e grava .json + .js na CDN', async () => {
    await save('editor', exp('exp_run', 'running'));
    await save('editor', exp('exp_draft', 'draft'));
    expect((await call('/publish', 'viewer', { method: 'POST' })).status).toBe(403);
    const r = await call('/publish', 'editor', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 1 });
    const cfg = PublishedConfigSchema.parse(JSON.parse(readFileSync(join(cdnDir, 'demo.json'), 'utf8')));
    expect(cfg.experiments.map((e) => e.id)).toEqual(['exp_run']);
    expect(cfg).toMatchObject({
      accountId: 'demo',
      apiUrl: 'https://api.abtest.dev',
      trackingUrl: 'https://api.abtest.dev/collect',
    });
    const js = readFileSync(join(cdnDir, 'demo.js'), 'utf8');
    expect(js.startsWith('window.__ABT_CONFIG__=')).toBe(true);
    expect(js).not.toContain('</script>');
    expect(js.endsWith('/*runtime*/')).toBe(true);
    // Servido pela CDN local.
    expect((await app.request('/cdn/demo.js')).status).toBe(200);
    expect(await (await call('/publish', 'editor', { method: 'POST' })).json()).toEqual({ version: 2 });
    expect((await repo.lastPublication('demo'))?.version).toBe(2);
  });

  test('customJS novo exige permissão; JS já publicado pode ser republicado por editor', async () => {
    await save('editor', exp('exp_js', 'running', 'console.log(1)'));
    const denied = await call('/publish', 'editor', { method: 'POST' });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toContain('JavaScript');
    expect((await call('/publish', 'owner', { method: 'POST' })).status).toBe(200);
    // Editor muda outra coisa e republica: JS idêntico ao publicado → permitido.
    const changed = exp('exp_js', 'running', 'console.log(1)');
    changed.experiment.name = 'Renomeado';
    await save('editor', changed);
    expect((await call('/publish', 'editor', { method: 'POST' })).status).toBe(200);
    // Editor altera o JS → bloqueado de novo.
    await save('editor', exp('exp_js', 'running', 'console.log(2)'));
    expect((await call('/publish', 'editor', { method: 'POST' })).status).toBe(403);
  });
});

describe('coleta de eventos', () => {
  const ev = (over: object = {}) => ({
    eventId: `ev_${Math.random()}`,
    ts: Date.now(),
    accountId: 'demo',
    visitorId: 'vis',
    url: 'http://localhost:5180/',
    experimentId: 'exp_run',
    experimentKey: 'exp-run',
    variationId: 'exp_run_v1',
    variationKey: 'b',
    type: 'selector_failed',
    operationId: 'o1',
    selector: 'h1',
    ...over,
  });
  const count = async () => {
    const r = (await db.execute(sql`select count(*)::int as n from events`)) as unknown as {
      rows: { n: number }[];
    };
    return Number(r.rows[0]?.n ?? 0);
  };

  test('aceita text/plain, guarda válidos, ignora inválidos, conta desconhecida e duplicados', async () => {
    const dup = ev();
    const res = await app.request('/collect', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://loja.com' },
      body: JSON.stringify({
        events: [dup, dup, ev({ type: 'exposure' }), ev({ type: 'lixo' }), ev({ accountId: 'fantasma' })],
      }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await count()).toBe(2);
    expect((await app.request('/collect', { method: 'POST', body: 'não é json' })).status).toBe(400);
  });
});

describe('saúde dos seletores', () => {
  const base = {
    ts: Date.now(),
    accountId: 'demo',
    visitorId: 'v',
    url: 'u',
    experimentId: 'exp_run',
    experimentKey: 'exp-run',
    variationKey: 'b',
  };
  test('agrega falhas e curas por operação, com a cura mais recente', async () => {
    const list = [
      { ...base, eventId: 'h1', type: 'exposure', variationId: 'exp_run_v1' },
      { ...base, eventId: 'h2', type: 'exposure', variationId: 'exp_run_v1' },
      {
        ...base,
        eventId: 'h3',
        type: 'selector_failed',
        variationId: 'exp_run_v1',
        operationId: 'oa',
        selector: 'h1',
      },
      {
        ...base,
        eventId: 'h4',
        ts: base.ts - 1000,
        type: 'selector_healed',
        variationId: 'exp_run_v1',
        operationId: 'ob',
        selector: '#a',
        healedSelector: '#velho',
        via: 'alternate',
      },
      {
        ...base,
        eventId: 'h5',
        type: 'selector_healed',
        variationId: 'exp_run_v1',
        operationId: 'ob',
        selector: '#a',
        healedSelector: 'main > p',
        via: 'fingerprint',
      },
    ];
    await app.request('/collect', { method: 'POST', body: JSON.stringify({ events: list }) });
    const r = await call('/experiments/exp_run/health', 'viewer');
    expect(r.status).toBe(200);
    const h = (await r.json()) as {
      exposures: Record<string, number>;
      operations: { operationId: string; failed: number; healed: number; lastHealed: unknown }[];
    };
    expect(h.exposures.exp_run_v1).toBe(3); // 2 + 1 do teste de coleta
    const byOp = Object.fromEntries(h.operations.map((o) => [o.operationId, o]));
    expect(byOp.oa).toMatchObject({ failed: 1, healed: 0, lastHealed: null });
    expect(byOp.ob).toMatchObject({
      failed: 0,
      healed: 2,
      lastHealed: { healedSelector: 'main > p', via: 'fingerprint' },
    });
    expect((await call('/experiments/nao-existe/health', 'viewer')).status).toBe(404);
  });
});

test('GET /experiments/{id}/conflicts', async () => {
  const mk = (id: string, selector: string) => {
    const b = exp(id, 'running');
    b.experiment.variations[1]!.operations = [
      { id: 'o1', order: 0, type: 'setText', target: { selector }, value: 'x' },
    ];
    return b;
  };
  await save('editor', mk('exp_c1', '#hero-title'));
  await save('editor', mk('exp_c2', '#hero-title'));
  const r = (await (await call('/experiments/exp_c1/conflicts', 'viewer')).json()) as {
    experimentId: string;
    selectors: string[];
  }[];
  expect(r.map((c) => c.experimentId)).toContain('exp_c2');
  expect(r.find((c) => c.experimentId === 'exp_c2')!.selectors).toEqual(['#hero-title']);
  expect((await call('/experiments/nao/conflicts', 'viewer')).status).toBe(404);
});
