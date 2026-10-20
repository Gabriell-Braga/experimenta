import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ExperimentSchema, nextExportAt } from '@abtest/shared';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { b64url } from './crypto';
import { BATCH, exportAll, exportStep } from './exports';
import { DEMO } from './seed';
import { sha256Hex, signV4 } from './sigv4';
import { ev, setupApp } from './test-app';

// Exportação agendada (19.4) contra servidores falsos de S3, BigQuery e token do Google (sem conta real).
type Req = { method: string; url: string; headers: Record<string, string>; body: string };
let reqs: Req[] = [];
let reply: (r: Req) => [number, unknown, string?] = () => [200, {}];
let server: Server;
let base = '';
let t: Awaited<ReturnType<typeof setupApp>>;
const ACC = DEMO.accountId;
const HOUR = 3_600_000;
const CRLF = String.fromCharCode(13, 10);
const BATCH0 = { ...BATCH };

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const r = { method: req.method!, url: req.url!, headers: req.headers as Record<string, string>, body };
      reqs.push(r);
      const [status, out, type = 'application/json'] = reply(r);
      res
        .writeHead(status, { 'content-type': type })
        .end(typeof out === 'string' ? out : JSON.stringify(out));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t = await setupApp({ exportBase: { s3: base, bigquery: base, oauth: `${base}/token` } });
});
afterAll(() => new Promise((ok) => server.close(ok)));
beforeEach(() => {
  reqs = [];
  reply = () => [200, {}];
});
afterEach(() => Object.assign(BATCH, BATCH0));

const put = (body: unknown, as = 'owner') =>
  t.req('/exports', { method: 'PUT', body: JSON.stringify(body), as });
const run = (as = 'editor') => t.req('/exports/run', { method: 'POST', as });
type View = {
  started?: boolean;
  hasS3Secret: boolean;
  serviceAccountEmail: string | null;
  status: {
    running: { events: number } | null;
    last: { ok: boolean; events: number; reports: number; error: string | null } | null;
    nextAt: string | null;
  };
  files: { id: string; name: string; kind: string; rows: number }[];
};
/** "Exportar agora" como a tela: repete enquanto a execução continua. */
async function runAll(as = 'editor') {
  let v: View | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await run(as);
    expect(r.status).toBe(200);
    v = (await r.json()) as View;
    if (!v.status.running) break;
  }
  return v!;
}

let n = 0;
const page = (ago: number, extra: Record<string, unknown> = {}) =>
  ev({
    type: 'pageview',
    device: 'desktop',
    ts: Date.now() - ago,
    url: `https://loja.com/p${++n}`,
    ...extra,
  } as never);

test('próximo horário: diária na hora UTC e semanal no dia da semana', () => {
  const at = Date.UTC(2026, 9, 20, 14, 0); // terça
  expect(new Date(nextExportAt({ frequency: 'daily', hour: 3, weekday: 1 }, at)).toISOString()).toBe(
    '2026-10-21T03:00:00.000Z',
  );
  expect(new Date(nextExportAt({ frequency: 'daily', hour: 15, weekday: 1 }, at)).toISOString()).toBe(
    '2026-10-20T15:00:00.000Z',
  );
  expect(new Date(nextExportAt({ frequency: 'weekly', hour: 3, weekday: 1 }, at)).toISOString()).toBe(
    '2026-10-26T03:00:00.000Z',
  );
});

test('CSV: só owner configura; incremental; QA, mapa de calor e os últimos 15 min ficam de fora; download', async () => {
  expect((await put({ enabled: true }, 'editor')).status).toBe(403);
  expect((await run()).status).toBe(400); // não configurado
  expect((await put({ enabled: true, events: false, reports: false })).status).toBe(400);
  const saved = (await (await put({ enabled: true, destination: 'csv' })).json()) as View;
  expect(Date.parse(saved.status.nextAt!)).toBeGreaterThan(Date.now());
  expect((await run('viewer')).status).toBe(403);

  await t.collect([
    page(2 * HOUR, { visitorId: '=1+1' }),
    page(HOUR),
    page(HOUR, { qa: true }),
    ev({ type: 'click', ts: Date.now() - HOUR, x: 1, y: 1, selector: 'a' } as never),
    page(60_000), // recente demais: fica para a próxima
    page(3 * 86_400_000), // antes do período da primeira exportação
  ]);
  const v = await runAll();
  expect(v.started).toBe(true);
  expect(v.status.last).toMatchObject({ ok: true, events: 2, error: null });
  expect(v.files).toHaveLength(1);
  const f = v.files[0]!;
  expect(f).toMatchObject({ kind: 'events', rows: 2 });

  const dl = await t.req(`/exports/files/${f.id}`, { as: 'viewer' });
  expect(dl.headers.get('content-type')).toContain('text/csv');
  const csv = await dl.text();
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe(
    '"event_id","ts","type","visitor_id","session_id","experiment_id","variation_id","goal_id","value","url","payload"',
  );
  expect(lines).toHaveLength(3);
  expect(csv).toContain(`"'=1+1"`); // fórmula neutralizada para planilha
  expect(csv).not.toContain('"click"');
  // Outra conta não baixa.
  expect((await t.req(`/exports/files/${f.id}`, { as: 'other' })).status).toBe(404);

  // Incremental: a próxima só leva o que é novo.
  await t.collect([page(30 * 60_000)]);
  const v2 = await runAll();
  expect(v2.status.last).toMatchObject({ ok: true, events: 1 });
  expect(v2.files).toHaveLength(2);
  const again = await runAll();
  expect(again.status.last).toMatchObject({ ok: true, events: 0 });
  expect(again.files).toHaveLength(2);

  const { items } = await t.get<{ items: { action: string; detail: string }[] }>(
    '/activities?type=integrations',
  );
  expect(items.some((a) => a.action === 'export')).toBe(true);
  expect(items.some((a) => a.action === 'update' && a.detail === 'csv ligada')).toBe(true);
});

test('S3: segredo só escrita; PUT assinado com SigV4 em lotes; erro do destino não avança o cursor', async () => {
  expect(
    (await put({ enabled: true, destination: 's3', s3: { bucket: 'meu-bucket', accessKeyId: 'AKIA1' } }))
      .status,
  ).toBe(400);
  const s3 = { bucket: 'meu-bucket', accessKeyId: 'AKIA1', region: 'auto', prefix: 'exp/' };
  const v = (await (
    await put({ enabled: true, destination: 's3', s3: { ...s3, secretAccessKey: 'segredo-s3' } })
  ).json()) as View;
  expect(v.hasS3Secret).toBe(true);
  expect(JSON.stringify(await t.get('/exports', 'viewer'))).not.toContain('segredo-s3');
  // Salvar sem o segredo mantém o guardado.
  expect((await put({ enabled: true, destination: 's3', s3 })).status).toBe(200);

  await t.collect([page(5 * HOUR), page(4 * HOUR), page(3 * HOUR)]);
  BATCH.s3 = 2;
  reply = () => [403, '<Error><Code>AccessDenied</Code></Error>', 'application/xml'];
  const fail = await runAll();
  expect(fail.status.last).toMatchObject({ ok: false, error: 'S3 respondeu 403 (AccessDenied)' });
  // Tenta de novo na próxima hora (não espera o dia seguinte).
  expect(Date.parse(fail.status.nextAt!) - Date.now()).toBeLessThanOrEqual(HOUR);

  reqs = [];
  reply = () => [200, ''];
  const ok = await runAll();
  // Destino novo começa do período da frequência (1 dia): todos os eventos de teste das últimas 24 h.
  expect(ok.status.last).toMatchObject({ ok: true, error: null });
  const evs = ok.status.last!.events;
  // Lotes de 2 (QA conta no lote, mas não vai): cada PUT com até 2 linhas, somando todos os eventos.
  expect(reqs.length).toBeGreaterThanOrEqual(Math.ceil(evs / 2));
  expect(reqs.reduce((n, q) => n + q.body.split(CRLF).length - 1, 0)).toBe(evs);
  const r = reqs[0]!;
  expect(r.method).toBe('PUT');
  expect(r.url).toMatch(/^\/meu-bucket\/exp\/events\/dt=\d{4}-\d{2}-\d{2}\/\d+-ev\d+-\w+\.csv$/);
  expect(r.headers['x-amz-content-sha256']).toBe(await sha256Hex(r.body));
  // A assinatura confere com o SigV4 recalculado pelo "servidor".
  const amz = r.headers['x-amz-date']!;
  const date = new Date(
    `${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`,
  );
  const expected = await signV4(
    {
      method: 'PUT',
      url: `${base}${r.url}`,
      headers: {
        'content-type': r.headers['content-type']!,
        'x-amz-content-sha256': r.headers['x-amz-content-sha256']!,
      },
      payloadHash: r.headers['x-amz-content-sha256']!,
    },
    { accessKeyId: 'AKIA1', secretAccessKey: 'segredo-s3', region: 'auto', service: 's3' },
    date,
  );
  expect(r.headers.authorization).toBe(expected.authorization);
  expect(r.headers.authorization).toContain('/auto/s3/aws4_request');
});

test('relatórios: linhas por teste em execução × meta × variação', async () => {
  const projectId = (await t.repo.listProjects(ACC))[0]!.id;
  await t.repo.saveExperiment(ACC, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id: 'exp_x',
      key: 'hero',
      name: 'Hero',
      status: 'running',
      variations: [
        { id: 'xv0', key: 'controle', name: 'Controle', weight: 50 },
        { id: 'xv1', key: 'b', name: 'B', weight: 50 },
      ],
      goals: [{ id: 'xg', key: 'compra', type: 'custom', event: 'compra' }],
    }),
  });
  await t.collect([
    ev({
      type: 'exposure',
      visitorId: 'r1',
      experimentId: 'exp_x',
      experimentKey: 'hero',
      variationId: 'xv0',
      variationKey: 'controle',
      ts: Date.now() - HOUR,
    } as never),
  ]);
  expect((await put({ enabled: true, destination: 'csv', events: false, reports: true })).status).toBe(200);
  const v = await runAll();
  expect(v.status.last).toMatchObject({ ok: true, reports: 2 });
  const f = v.files.find((x) => x.kind === 'reports')!;
  const csv = await (await t.req(`/exports/files/${f.id}`, { as: 'owner' })).text();
  expect(csv).toContain('"snapshot_at","period_from","period_to","experiment_id"');
  expect(csv).toContain('"exp_x","hero","Hero","xg","compra","true","xv0","controle","Controle","1"');
});

test('BigQuery: conta de serviço só escrita, JWT RS256 válido, insertAll com insertId; erro de linha aparece', async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der));
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  const sa = JSON.stringify({
    type: 'service_account',
    client_email: 'exp@proj.iam.gserviceaccount.com',
    private_key: pem,
  });
  const bq = { projectId: 'meu-projeto', dataset: 'experimenta' };
  expect(
    (await put({ enabled: true, destination: 'bigquery', bigquery: { ...bq, serviceAccount: '{"x":1}' } }))
      .status,
  ).toBe(400);
  const v = (await (
    await put({ enabled: true, destination: 'bigquery', bigquery: { ...bq, serviceAccount: sa } })
  ).json()) as View;
  expect(v.serviceAccountEmail).toBe('exp@proj.iam.gserviceaccount.com');
  expect(JSON.stringify(await t.get('/exports'))).not.toContain('PRIVATE KEY');

  let jwtOk = false;
  reply = (r) => {
    if (r.url === '/token') {
      const assertion = new URLSearchParams(r.body).get('assertion')!;
      const [h, p, s] = assertion.split('.');
      const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      void crypto.subtle
        .verify('RSASSA-PKCS1-v1_5', pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`))
        .then((ok) => (jwtOk = ok));
      const claims = JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/')));
      expect(claims).toMatchObject({
        iss: 'exp@proj.iam.gserviceaccount.com',
        aud: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/bigquery.insertdata',
      });
      expect(claims.exp - claims.iat).toBe(3600);
      expect(b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))).toBe(h);
      return [200, { access_token: 'ya29.token', expires_in: 3600 }];
    }
    return [200, { kind: 'bigquery#tableDataInsertAllResponse' }];
  };
  await t.collect([page(2 * HOUR)]);
  const ok = await runAll();
  expect(ok.status.last).toMatchObject({ ok: true, error: null });
  await expect.poll(() => jwtOk).toBe(true);
  const ins = reqs.filter((r) => r.url.endsWith('/insertAll'));
  expect(ins[0]!.url).toBe('/bigquery/v2/projects/meu-projeto/datasets/experimenta/tables/events/insertAll');
  expect(ins[0]!.headers.authorization).toBe('Bearer ya29.token');
  const rows = JSON.parse(ins[0]!.body).rows as { insertId: string; json: Record<string, unknown> }[];
  expect(rows[0]!.insertId).toBe(rows[0]!.json.event_id);
  expect(Object.keys(rows[0]!.json)).toContain('payload');

  await t.collect([page(20 * 60_000)]); // depois do último exportado e antes dos 15 min
  reply = (r) =>
    r.url === '/token'
      ? [200, { access_token: 'ya29.token' }]
      : [
          200,
          {
            insertErrors: [
              { index: 0, errors: [{ reason: 'invalid', location: 'ts', message: 'no such field' }] },
            ],
          },
        ];
  const bad = await runAll();
  expect(bad.status.last).toMatchObject({
    ok: false,
    error: 'BigQuery recusou 1 linha(s): ts: no such field',
  });
});

test('job: só roda vencido; vez única (passos simultâneos não duplicam); desligado não roda', async () => {
  expect((await put({ enabled: true, destination: 'csv' })).status).toBe(200);
  await t.collect([page(HOUR)]);
  const before = (await t.get<View>('/exports')).files.length;
  await exportAll(t.repo); // não venceu
  expect((await t.get<View>('/exports')).files.length).toBe(before);
  const later = Date.now() + 2 * 86_400_000;
  const [a, b] = await Promise.all([
    exportStep(t.repo, ACC, { now: later }),
    exportStep(t.repo, ACC, { now: later }),
  ]);
  expect([a, b].filter((x) => 'started' in x && x.started)).toHaveLength(1);
  for (let i = 0; i < 5; i++) await exportStep(t.repo, ACC, { now: later + 1 });
  const v = await t.get<View>('/exports');
  expect(v.status.running).toBeNull();
  expect(Date.parse(v.status.nextAt!)).toBeGreaterThan(later);
  expect((await put({ enabled: false, destination: 'csv' })).status).toBe(200);
  expect(await exportStep(t.repo, ACC, { now: later + 10 * 86_400_000 })).toEqual({
    started: false,
    running: false,
  });
});
