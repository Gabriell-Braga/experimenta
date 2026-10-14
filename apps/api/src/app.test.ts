import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app';
import { compileAccountScript, writeAccountFiles } from './cdn';
import { createDb, type Db } from './db';
import { createSessionStore } from './sessions';

const APP = 'http://localhost:5173';
let db: Db;
let cdnDir: string;
beforeAll(async () => {
  db = await createDb();
  cdnDir = mkdtempSync(join(tmpdir(), 'abt-cdn-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
});
const make = (sessions = createSessionStore()) => createApp({ db, cdnDir, editorOrigins: [APP], sessions });

test('GET /health', async () => {
  expect(await (await make().request('/health')).json()).toEqual({ ok: true });
});

describe('sessões de edição', () => {
  const create = (app: ReturnType<typeof make>, origin = APP, accountId = 'demo') =>
    app.request('/edit-sessions', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });

  test('cria e valida token; resposta não devolve dados além do necessário', async () => {
    const app = make();
    const res = await create(app);
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(token.length).toBeGreaterThanOrEqual(32);
    const check = await app.request(`/edit-sessions/${token}`, { headers: { origin: 'https://loja.com' } });
    expect(check.status).toBe(200);
    expect(check.headers.get('access-control-allow-origin')).toBe('*');
    expect(Object.keys(await check.json()).sort()).toEqual(['accountId', 'appOrigin', 'expiresAt']);
  });

  test('origin fora da lista é recusado', async () => {
    expect((await create(make(), 'https://evil.com')).status).toBe(403);
    expect((await create(make(), APP, '')).status).toBe(400);
  });

  test('token inexistente ou expirado → 404', async () => {
    let now = 0;
    const store = createSessionStore(() => now);
    const app = make(store);
    const { token } = (await (await create(app)).json()) as { token: string };
    expect((await app.request('/edit-sessions/nao-existe')).status).toBe(404);
    now += 15 * 60 * 1000;
    expect((await app.request(`/edit-sessions/${token}`)).status).toBe(404);
  });
});

describe('CDN local', () => {
  test('publica .js (config + runtime) e .json; serve com ETag e cache curto', async () => {
    const config = { accountId: 'acc1', version: 2, publishedAt: new Date().toISOString(), experiments: [] };
    writeAccountFiles(cdnDir, config);
    expect(JSON.parse(readFileSync(join(cdnDir, 'acc1.json'), 'utf8'))).toEqual(config);
    const app = make();
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
    const app = make();
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
