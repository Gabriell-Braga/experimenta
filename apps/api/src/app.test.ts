import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app';
import { fsCdnStore } from './cdn-fs';
import { compileAccountScript, writeAccountFiles } from './cdn';
import { type Repo } from './repo';
import { testRepo } from './test-repo';
import { DEMO, seedDev } from './seed';
import { createSessionStore } from './sessions';

const APP = 'http://localhost:5173';
let repo: Repo;
let cdnDir: string;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
let projectId: string;

const req = (path: string, init: RequestInit & { as?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('origin', APP);
  if (init.as) headers.set('authorization', `Bearer ${tokens[init.as]}`);
  if (init.body) headers.set('content-type', 'application/json');
  return app.request(path, { ...init, headers });
};

const experiment = (id: string, key: string, customJS = '') => ({
  id,
  key,
  name: key,
  status: 'running',
  variations: [
    { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
    { id: `${id}_v1`, key: 'b', name: 'B', weight: 50, customJS },
  ],
});

beforeAll(async () => {
  repo = await testRepo();
  await seedDev(repo);
  cdnDir = mkdtempSync(join(tmpdir(), 'abt-cdn-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
  app = createApp({
    repo,
    cdn: fsCdnStore(cdnDir),
    editorOrigins: [APP],
    jwtSecret: 'teste',
    sessions: createSessionStore(),
  });
  for (const [who, cred] of Object.entries({ owner: DEMO.owner, editor: DEMO.editor, viewer: DEMO.viewer })) {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify(cred) });
    tokens[who] = ((await r.json()) as { token: string }).token;
  }
  // Outra conta, para testar isolamento.
  const other = await repo.createAccount('Outra');
  await repo.createUser(other.id, { email: 'x@outra.com', name: 'X', password: 'x12345678', role: 'owner' });
  tokens.other = (
    (await (
      await req('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'x@outra.com', password: 'x12345678' }),
      })
    ).json()) as {
      token: string;
    }
  ).token;
  projectId = (await repo.listProjects(DEMO.accountId))[0]!.id;
});

test('GET /health', async () => {
  expect(await (await app.request('/health')).json()).toEqual({ ok: true });
});

test('cota diária do plano grátis vira 503 plan_limit com CORS; outro erro vira 500 genérico', async () => {
  const failing = (message: string) =>
    createApp({
      repo: {
        ...repo,
        listProjects: async () => {
          throw new Error(message);
        },
      },
      cdn: fsCdnStore(cdnDir),
      editorOrigins: [APP],
      jwtSecret: 'teste',
      sessions: createSessionStore(),
    }).request('/projects', {
      headers: { origin: APP, authorization: `Bearer ${tokens.owner}` },
    });
  const limit = await failing('D1_ERROR: Exceeded maximum daily rows written');
  expect(limit.status).toBe(503);
  expect(limit.headers.get('access-control-allow-origin')).toBe(APP);
  expect(await limit.json()).toMatchObject({ code: 'plan_limit' });
  const other = await failing('boom');
  expect(other.status).toBe(500);
  expect(await other.json()).toEqual({ error: 'erro interno' });
});

describe('autenticação', () => {
  test('login inválido → 401; sem token → 401; token adulterado → 401', async () => {
    expect(
      (
        await req('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: DEMO.owner.email, password: 'x' }),
        })
      ).status,
    ).toBe(401);
    expect((await req('/me')).status).toBe(401);
    expect((await app.request('/me', { headers: { authorization: `Bearer ${tokens.owner}x` } })).status).toBe(
      401,
    );
  });

  test('/me devolve o usuário sem hash de senha', async () => {
    const me = (await (await req('/me', { as: 'editor' })).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ email: DEMO.editor.email, role: 'editor', accountId: 'demo' });
    expect(me).not.toHaveProperty('passwordHash');
  });

  test('CORS da API privada só para o app do editor', async () => {
    const pre = await app.request('/experiments', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.com', 'access-control-request-method': 'GET' },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await app.request('/experiments', {
      method: 'OPTIONS',
      headers: { origin: APP, 'access-control-request-method': 'GET' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
  });
});

describe('experimentos e permissões', () => {
  test('editor cria, lê, atualiza (nova versão) e lista; viewer só lê', async () => {
    const body = { projectId, editorUrl: 'http://localhost:5180/', experiment: experiment('exp_1', 'hero') };
    expect(
      (await req('/experiments', { method: 'POST', as: 'viewer', body: JSON.stringify(body) })).status,
    ).toBe(403);
    const created = await req('/experiments', { method: 'POST', as: 'editor', body: JSON.stringify(body) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ version: 1 });
    const upd = await req('/experiments/exp_1', {
      method: 'PUT',
      as: 'editor',
      body: JSON.stringify({ ...body, experiment: { ...body.experiment, name: 'Hero 2' } }),
    });
    expect(await upd.json()).toEqual({ version: 2 });
    const got = (await (await req('/experiments/exp_1', { as: 'viewer' })).json()) as {
      experiment: { name: string };
    };
    expect(got.experiment.name).toBe('Hero 2');
    const list = (await (await req('/experiments', { as: 'viewer' })).json()) as { id: string }[];
    expect(list.map((e) => e.id)).toContain('exp_1');
    const versions = (await (await req('/experiments/exp_1/versions', { as: 'viewer' })).json()) as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await req('/experiments/exp_1', { method: 'DELETE', as: 'viewer' })).status).toBe(403);
  });

  test('validação: experimento inválido → 400; id diferente na URL → 400; chave repetida → 409', async () => {
    const bad = await req('/experiments', {
      method: 'POST',
      as: 'editor',
      body: JSON.stringify({
        projectId,
        editorUrl: 'http://x/',
        experiment: { id: 'e', key: 'Chave Inválida', variations: [] },
      }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('experiment.key');
    const body = { projectId, editorUrl: 'http://localhost:5180/', experiment: experiment('exp_2', 'hero') };
    expect(
      (await req('/experiments/outro', { method: 'PUT', as: 'editor', body: JSON.stringify(body) })).status,
    ).toBe(400);
    expect(
      (await req('/experiments', { method: 'POST', as: 'editor', body: JSON.stringify(body) })).status,
    ).toBe(409);
  });

  test('outra conta não enxerga nem altera', async () => {
    expect((await req('/experiments/exp_1', { as: 'other' })).status).toBe(404);
    expect(((await (await req('/experiments', { as: 'other' })).json()) as unknown[]).length).toBe(0);
    const hijack = { projectId, editorUrl: 'http://x/', experiment: experiment('exp_1', 'roubo') };
    expect(
      (await req('/experiments/exp_1', { method: 'PUT', as: 'other', body: JSON.stringify(hijack) })).status,
    ).toBe(404);
    expect((await req('/experiments/exp_1', { method: 'DELETE', as: 'other' })).status).toBe(404);
  });

  test('projetos', async () => {
    expect(
      (
        await req('/projects', {
          method: 'POST',
          as: 'viewer',
          body: JSON.stringify({ name: 'p', siteUrl: 'https://p.com' }),
        })
      ).status,
    ).toBe(403);
    const p = await req('/projects', {
      method: 'POST',
      as: 'editor',
      body: JSON.stringify({ name: 'p', siteUrl: 'https://p.com' }),
    });
    expect(p.status).toBe(201);
    expect(((await (await req('/projects', { as: 'other' })).json()) as unknown[]).length).toBe(0);
  });
});

describe('sessões de edição', () => {
  test('exige login de editor e origin autorizado; validação pública', async () => {
    expect((await req('/edit-sessions', { method: 'POST' })).status).toBe(401);
    expect((await req('/edit-sessions', { method: 'POST', as: 'viewer' })).status).toBe(201); // ver mapas de calor
    const evil = await app.request('/edit-sessions', {
      method: 'POST',
      headers: { origin: 'https://evil.com', authorization: `Bearer ${tokens.editor}` },
    });
    expect(evil.status).toBe(403);
    const res = await req('/edit-sessions', { method: 'POST', as: 'editor' });
    expect(res.status).toBe(201);
    const { token, accountId } = (await res.json()) as { token: string; accountId: string };
    expect(accountId).toBe('demo'); // conta vem do login, não do corpo
    const check = await app.request(`/edit-sessions/${token}`, { headers: { origin: 'https://loja.com' } });
    expect(check.status).toBe(200);
    expect(check.headers.get('access-control-allow-origin')).toBe('*');
    expect(Object.keys(await check.json()).sort()).toEqual(['accountId', 'appOrigin', 'expiresAt']);
    expect((await app.request('/edit-sessions/nao-existe')).status).toBe(404);
  });

  test('token expira', async () => {
    let now = 0;
    const store = createSessionStore(() => now);
    const s = await store.create('demo', APP);
    now += 15 * 60 * 1000;
    expect(await store.get(s.token)).toBeUndefined();
  });
});

test('OpenAPI gerado com as rotas e segurança bearer', async () => {
  const doc = (await (await app.request('/openapi.json')).json()) as {
    paths: Record<string, unknown>;
    components: { securitySchemes: Record<string, unknown> };
  };
  expect(Object.keys(doc.paths)).toEqual(
    expect.arrayContaining([
      '/auth/login',
      '/me',
      '/projects',
      '/experiments',
      '/experiments/{id}',
      '/edit-sessions',
      '/publish',
    ]),
  );
  expect(doc.components.securitySchemes.bearer).toBeDefined();
});

describe('CDN local', () => {
  test('publica .js (config + runtime) e .json; serve com ETag e cache curto', async () => {
    const config = { accountId: 'acc1', version: 2, publishedAt: new Date().toISOString(), experiments: [] };
    await writeAccountFiles(fsCdnStore(cdnDir), config);
    expect(JSON.parse(readFileSync(join(cdnDir, 'acc1.json'), 'utf8'))).toEqual(config);
    const res = await app.request('/cdn/acc1.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.text()).toBe(compileAccountScript(config, '/*runtime*/'));
    const again = await app.request('/cdn/acc1.js', {
      headers: { 'if-none-match': res.headers.get('etag')! },
    });
    expect(again.status).toBe(304);
  });

  test('não sai da pasta nem serve tipos desconhecidos', async () => {
    expect((await app.request('/cdn/..%2F..%2Fpackage.json')).status).toBe(404);
    expect((await app.request('/cdn/nao-existe.js')).status).toBe(404);
  });

  test('HTML de operação não fecha a tag <script>', () => {
    const js = compileAccountScript(
      {
        accountId: 'a',
        version: 1,
        publishedAt: '',
        experiments: [],
        trackingUrl: '</script><script>alert(1)',
      },
      '',
    );
    expect(js).not.toContain('</script>');
  });
});
