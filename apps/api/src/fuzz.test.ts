// Robustez da API: percorre todas as rotas do /openapi.json e manda entradas erradas (sem token, papel sem
// permissão, JSON quebrado, tipos trocados, textos enormes, ids inexistentes, envios duplicados em paralelo).
// Regra: nenhuma resposta 5xx — entrada ruim é sempre 4xx com mensagem — e o que for aceito não pode quebrar
// leituras nem a publicação depois.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ENTITY_SCHEMAS, ExperimentSchema } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import { createApp } from './app';
import { fsCdnStore } from './cdn-fs';
import { createPublisher } from './publish';
import { DEMO, seedDev } from './seed';
import { createSessionStore } from './sessions';
import { testRepo } from './test-repo';

const APP = 'http://localhost:5173';
type Schema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Op {
  method: string;
  path: string;
  secured: boolean;
  params: { name: string; in: string; schema?: Schema }[];
  body?: Schema;
}

let app: ReturnType<typeof createApp>;
let ops: Op[] = [];
let components: Record<string, Schema> = {};
const tokens: Record<string, string> = {};
/** JSON schema de `data` de cada tipo de entidade e do experimento (a especificação só diz `unknown`). */
const dataSchemas: Record<string, Schema> = {};

const req = (path: string, init: { method?: string; body?: string; as?: string; type?: string } = {}) => {
  const headers = new Headers({ origin: APP });
  if (init.as) headers.set('authorization', `Bearer ${tokens[init.as]}`);
  if (init.body !== undefined) headers.set('content-type', init.type ?? 'application/json');
  return app.request(path, { method: init.method ?? 'GET', body: init.body, headers });
};

const resolve = (s: Schema | undefined): Schema =>
  s?.$ref ? resolve(components[s.$ref.split('/').pop()!]) : (s ?? {});

/** Gera um valor válido (o mais simples possível) para o schema — base para as mutações. */
function sample(raw: Schema | undefined, depth = 0): unknown {
  const s = resolve(raw);
  if (depth > 8) return undefined;
  const alt = s.oneOf ?? s.anyOf;
  if (alt) return sample(alt.find((x: Schema) => resolve(x).type !== 'null') ?? alt[0], depth + 1);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x: Schema) => sample(x, depth + 1)));
  if (s.enum) return s.enum[0];
  if ('const' in s) return s.const;
  if ('default' in s) return s.default;
  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== 'null') : s.type;
  switch (type) {
    case 'string':
      if (s.format === 'uri' || s.format === 'url') return 'https://example.com/';
      if (s.format === 'email') return 'a@b.com';
      if (s.format === 'date-time') return new Date().toISOString();
      return 'x'.repeat(Math.max(1, s.minLength ?? 1));
    case 'number':
    case 'integer':
      return Math.min(Math.max(1, s.minimum ?? 1, s.exclusiveMinimum ?? 0), s.maximum ?? Infinity);
    case 'boolean':
      return true;
    case 'array':
      return Array.from({ length: Math.max(1, s.minItems ?? 0) }, () => sample(s.items, depth + 1));
    case 'object':
    default: {
      if (!s.properties) return {};
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<Schema>(s.properties)) o[k] = sample(v, depth + 1);
      return o;
    }
  }
}

const HUGE = 'a'.repeat(200_000);
const NASTY = [
  '',
  ' ',
  null,
  -1,
  0,
  1e308,
  -1e308,
  true,
  [],
  {},
  HUGE,
  '<script>alert(1)</script>',
  "' OR 1=1 --",
  '../../etc/passwd',
  '😀'.repeat(50),
  'NaN',
  '1e999',
  '2026-13-45',
  'não-é-url',
];

/** Caminhos de todas as folhas (e nós) de um valor: ['a'], ['a', 0, 'b']… */
function paths(v: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (!v || typeof v !== 'object') return prefix.length ? [prefix] : [];
  const kids = Object.entries(v).flatMap(([k, c]) => paths(c, [...prefix, Array.isArray(v) ? Number(k) : k]));
  return prefix.length ? [prefix, ...kids] : kids;
}
function setAt(v: unknown, path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(v) as Record<string | number, unknown>;
  let cur = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  cur[path.at(-1)!] = value;
  return copy;
}
const mutations = (base: unknown) =>
  paths(base).flatMap((p) => [
    ...NASTY.map((v) => ({
      label: `${p.join('.')}=${JSON.stringify(v)?.slice(0, 30)}`,
      value: setAt(base, p, v),
    })),
    { label: `${p.join('.')} faltando`, value: setAt(base, p, undefined) },
  ]);

/** Corpos ruins genéricos (JSON quebrado, tipo errado, fundo demais, chaves demais). */
const BROKEN = [
  '',
  '{',
  '{"a":',
  'null',
  '[]',
  '"texto"',
  '123',
  'true',
  JSON.stringify({ x: HUGE }),
  '{"a":'.repeat(10_000) + '1' + '}'.repeat(10_000),
  JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]))),
];

const BAD_IDS = [
  'nao-existe',
  '0',
  '-1',
  'a'.repeat(5000),
  '%00',
  '..%2F..%2Fx',
  '%3Cscript%3E',
  "'%20OR%201=1",
];

/** Troca os parâmetros de caminho: enum (ex.: `kind`) vira cada valor válido; o resto, `id`. */
function fills(op: Op, id: string): string[] {
  let out = [op.path];
  for (const p of op.params.filter((p) => p.in === 'path')) {
    const values: string[] = resolve(p.schema).enum ?? [id];
    out = out.flatMap((path) => values.map((v) => path.replace(`{${p.name}}`, v)));
  }
  return out;
}

beforeAll(async () => {
  const repo = await testRepo();
  await seedDev(repo);
  const cdnDir = mkdtempSync(join(tmpdir(), 'abt-fuzz-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
  const cdn = fsCdnStore(cdnDir);
  app = createApp({
    repo,
    cdn,
    editorOrigins: [APP],
    jwtSecret: 'teste',
    sessions: createSessionStore(),
    publish: createPublisher({ repo, cdn, publicUrl: 'https://api.abtest.dev' }),
  });
  for (const [who, cred] of Object.entries({ owner: DEMO.owner, viewer: DEMO.viewer })) {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify(cred) });
    tokens[who] = ((await r.json()) as { token: string }).token;
  }
  const doc = (await (await req('/openapi.json')).json()) as Schema;
  ops = Object.entries<Schema>(doc.paths).flatMap(([path, item]) =>
    Object.entries<Schema>(item)
      .filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map(([method, op]) => ({
        method: method.toUpperCase(),
        path,
        secured: !!op.security?.length,
        params: op.parameters ?? [],
        body: op.requestBody?.content?.['application/json']?.schema,
      })),
  );
  // Schemas zod → JSON schema pelo mesmo gerador da especificação (uma rota fictícia por schema).
  const gen = new OpenAPIHono();
  for (const [name, schema] of Object.entries({ ...ENTITY_SCHEMAS, experiment: ExperimentSchema }))
    gen.openapi(
      createRoute({
        method: 'post',
        path: `/${name}`,
        request: { body: { content: { 'application/json': { schema } } } },
        responses: { 200: { description: 'ok' } },
      }),
      (c) => c.body(null),
    );
  const genDoc = gen.getOpenAPIDocument({ openapi: '3.0.0', info: { title: 'x', version: '1' } }) as Schema;
  components = { ...(genDoc.components?.schemas ?? {}), ...(doc.components?.schemas ?? {}) };
  for (const name of [...Object.keys(ENTITY_SCHEMAS), 'experiment'])
    dataSchemas[name] = genDoc.paths[`/${name}`].post.requestBody.content['application/json'].schema;
}, 60_000);

/** Roda as chamadas e devolve as que deram 5xx (ou exceção) como texto legível. */
async function run(calls: { label: string; go: () => Response | Promise<Response> }[]) {
  const fails: string[] = [];
  for (const c of calls) {
    try {
      const r = await c.go();
      if (r.status >= 500) fails.push(`${r.status} ${c.label}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      fails.push(`exceção ${c.label}: ${(e as Error).message}`);
    }
  }
  return fails;
}

test('a especificação lista rotas e os schemas das entidades', () => {
  expect(ops.length).toBeGreaterThan(50);
  expect(Object.keys(dataSchemas).length).toBe(Object.keys(ENTITY_SCHEMAS).length + 1);
});

test('rotas protegidas: sem token, token lixo e token de outra assinatura → 401', async () => {
  const wrong: string[] = [];
  for (const op of ops.filter((o) => o.secured))
    for (const auth of [
      undefined,
      'Bearer lixo',
      'Bearer eyJhbGciOiJub25lIn0.e30.',
      'Basic YTpi',
      'Bearer ',
    ]) {
      const r = await app.request(fills(op, 'x')[0]!, {
        method: op.method,
        headers: auth ? { authorization: auth, origin: APP } : { origin: APP },
      });
      if (r.status !== 401) wrong.push(`${r.status} ${op.method} ${op.path} (${auth ?? 'sem token'})`);
    }
  expect(wrong).toEqual([]);
}, 120_000);

test('viewer não escreve: POST/PUT/PATCH/DELETE → 4xx', async () => {
  const wrong: string[] = [];
  for (const op of ops.filter((o) => o.secured && o.method !== 'GET'))
    for (const path of fills(op, 'x')) {
      const r = await req(path, { method: op.method, as: 'viewer', body: JSON.stringify(sample(op.body)) });
      if (r.status < 400 || r.status >= 500) wrong.push(`${r.status} ${op.method} ${path}`);
    }
  // Sessão de edição: viewer abre o editor em modo leitura. Conta nova: quem cria é owner dela, não escreve nesta.
  // Segurança pessoal (duas etapas, sair dos outros lugares): é da pessoa, qualquer papel faz.
  // Passo da geração de ideias: só avança a que um editor iniciou (sem geração, não faz nada).
  const allowed = [
    '200 POST /ai/ideas/step',
    '201 POST /edit-sessions',
    '201 POST /accounts',
    '200 POST /me/totp/setup',
    '200 DELETE /sessions',
  ];
  expect(wrong.filter((w) => !allowed.includes(w))).toEqual([]);
}, 120_000);

test('corpos quebrados e campos de topo trocados em toda rota com corpo → nunca 5xx', async () => {
  const calls = ops
    .filter((o) => o.body)
    .flatMap((op) =>
      fills(op, 'nao-existe').flatMap((path) =>
        [...BROKEN, ...mutations(sample(op.body)).map((m) => JSON.stringify(m.value))].map((body) => ({
          label: `${op.method} ${path} corpo=${body.slice(0, 60)}`,
          go: () => req(path, { method: op.method, as: 'owner', body }),
        })),
      ),
    );
  expect(await run(calls)).toEqual([]);
}, 300_000);

test('dados de cada entidade com qualquer campo trocado por lixo → nunca 5xx', async () => {
  const calls = Object.keys(ENTITY_SCHEMAS).flatMap((kind) =>
    mutations(sample(dataSchemas[kind])).map((m) => ({
      label: `POST /entities/${kind} data.${m.label}`,
      go: () =>
        req(`/entities/${kind}`, {
          method: 'POST',
          as: 'owner',
          body: JSON.stringify({ name: `fuzz ${m.label}`.slice(0, 120), data: m.value }),
        }),
    })),
  );
  expect(calls.length).toBeGreaterThan(500);
  expect(await run(calls)).toEqual([]);
}, 300_000);

test('experimento com qualquer campo trocado por lixo → nunca 5xx', async () => {
  const projectId = ((await (await req('/projects', { as: 'owner' })).json()) as { id: string }[])[0]!.id;
  const base = sample(dataSchemas.experiment) as Record<string, unknown>;
  const calls = mutations(base).map((m, i) => ({
    label: `POST /experiments experiment.${m.label}`,
    go: () =>
      req('/experiments', {
        method: 'POST',
        as: 'owner',
        body: JSON.stringify({
          projectId,
          editorUrl: 'https://example.com/',
          experiment: { ...(m.value as object), id: `fz${i}`, key: `fz${i}` },
        }),
      }),
  }));
  expect(await run(calls)).toEqual([]);
}, 300_000);

test('nomes vazios, só espaços ou enormes → 400', async () => {
  const projectId = ((await (await req('/projects', { as: 'owner' })).json()) as { id: string }[])[0]!.id;
  const exp = sample(dataSchemas.experiment) as Record<string, unknown>;
  const accepted: string[] = [];
  for (const name of ['', '   ', HUGE]) {
    const bodies: [string, unknown][] = [
      ['/projects', { name, siteUrl: 'https://example.com/' }],
      ['/account/api-keys', { name }],
      ['/entities/funnel', { name, data: sample(dataSchemas.funnel) }],
      [
        '/experiments',
        { projectId, editorUrl: 'https://example.com/', experiment: { ...exp, id: 'nm', key: 'nm', name } },
      ],
    ];
    for (const [path, body] of bodies) {
      const r = await req(path, { method: 'POST', as: 'owner', body: JSON.stringify(body) });
      if (r.status !== 400) accepted.push(`${r.status} ${path} name=${name.slice(0, 10)}`);
    }
  }
  expect(accepted).toEqual([]);
});

test('ids e query strings inválidos em toda rota → nunca 5xx', async () => {
  const calls = ops.flatMap((op) => {
    const query = op.params.filter((p) => p.in === 'query');
    const qs = [
      '',
      ...query.flatMap((p) =>
        ['', 'x', '-1', '0', '99999999999', 'NaN', '2026-99-99', '%00', 'a'.repeat(5000)].map(
          (v) => `?${p.name}=${v}`,
        ),
      ),
      '?' + query.map((p) => `${p.name}=${p.name}&${p.name}=dup`).join('&'),
    ];
    return (op.path.includes('{') ? BAD_IDS.flatMap((id) => fills(op, id)) : [op.path]).flatMap((path) =>
      qs.map((q) => ({
        label: `${op.method} ${path.slice(0, 80)}${q.slice(0, 60)}`,
        go: () =>
          req(path + q, {
            method: op.method,
            as: 'owner',
            body: op.body ? JSON.stringify(sample(op.body)) : undefined,
          }),
      })),
    );
  });
  expect(await run(calls)).toEqual([]);
}, 300_000);

test('envio duplicado em paralelo (duplo clique) → nunca 5xx', async () => {
  const fails: string[] = [];
  for (const op of ops.filter((o) => o.method !== 'GET' && o.path !== '/auth/login'))
    for (const path of fills(op, 'x')) {
      const body = op.body ? JSON.stringify(sample(op.body)) : undefined;
      const rs = await Promise.all(
        Array.from({ length: 5 }, () => req(path, { method: op.method, as: 'owner', body })),
      );
      for (const r of rs) if (r.status >= 500) fails.push(`${r.status} ${op.method} ${path}`);
    }
  expect(fails).toEqual([]);
}, 120_000);

test('depois de tudo que foi aceito acima, leituras e publicação seguem sem 5xx', async () => {
  // Ids reais das entidades e experimentos gravados pelos testes anteriores.
  const ids: Record<string, string[]> = {};
  for (const kind of Object.keys(ENTITY_SCHEMAS))
    ids[kind] = ((await (await req(`/entities/${kind}`, { as: 'owner' })).json()) as { id: string }[]).map(
      (e) => e.id,
    );
  const exps = ((await (await req('/experiments', { as: 'owner' })).json()) as { id: string }[]).map(
    (e) => e.id,
  );
  expect(exps.length).toBeGreaterThan(5); // o fuzz de experimento gravou casos aceitos
  const calls = ops
    .filter((o) => o.method === 'GET')
    .flatMap((op) => {
      const pool = op.path.includes('funnel')
        ? ids.funnel!
        : op.path.includes('survey')
          ? ids.survey!
          : op.path.includes('segments')
            ? ids.segment!
            : op.path.startsWith('/experiments')
              ? exps
              : ['x'];
      return pool.slice(0, 40).flatMap((id) => fills(op, id));
    })
    .map((path) => ({ label: `GET ${path}`, go: () => req(path, { as: 'owner' }) }));
  calls.push({ label: 'POST /publish', go: () => req('/publish', { method: 'POST', as: 'owner' }) });
  calls.push({ label: 'POST /ai/ideas', go: () => req('/ai/ideas', { method: 'POST', as: 'owner' }) });
  expect(await run(calls)).toEqual([]);
}, 300_000);

test('rotas públicas fora da especificação aguentam lixo', async () => {
  const bodies = [
    '',
    '{',
    'null',
    '[]',
    '"x"',
    '{"events":null}',
    '{"events":[null,1,"x",{}]}',
    JSON.stringify({ events: [{ accountId: DEMO.accountId }] }),
    'a'.repeat(70 * 1024),
  ];
  const calls = [
    ...bodies.map((body) => ({
      label: `POST /collect ${body.slice(0, 40)}`,
      go: () => req('/collect', { method: 'POST', body, type: 'text/plain' }),
    })),
    ...BAD_IDS.flatMap((id) => [
      { label: `GET /cdn/${id.slice(0, 40)}`, go: () => req(`/cdn/${id}`) },
      { label: `GET /reco/${id.slice(0, 40)}`, go: () => req(`/reco/${id}/${id}`) },
      { label: `GET /edit-sessions/${id.slice(0, 40)}`, go: () => req(`/edit-sessions/${id}`) },
    ]),
  ];
  expect(await run(calls)).toEqual([]);
});
