import { beforeAll, expect, test } from 'vitest';
import { createLimiter, EMAIL_LIMIT, IP_LIMIT } from './login-guard';
import { DEMO } from './seed';
import { setupApp } from './test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  t = await setupApp();
});

const login = (email: string, password: string, ip = '1.1.1.1') =>
  t.app.request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  });

test('limitador: bloqueia no limite, libera ao fim da janela e zera no reset', () => {
  let now = 0;
  const l = createLimiter(3, 1000, () => now);
  expect([l.fail('k'), l.fail('k'), l.fail('k')]).toEqual([false, false, true]);
  expect(l.blocked('k')).toBe(1);
  expect(l.blocked('outra')).toBe(0);
  now = 1001;
  expect(l.blocked('k')).toBe(0);
  l.fail('k');
  l.reset('k');
  expect(l.blocked('k')).toBe(0);
});

test('por e-mail: senha errada várias vezes bloqueia até a senha certa, mesmo de outro IP', async () => {
  for (let i = 0; i < EMAIL_LIMIT; i++)
    expect((await login(DEMO.editor.email, 'errada', `9.9.9.${i}`)).status).toBe(401);
  const r = await login(DEMO.editor.email, DEMO.editor.password, '8.8.8.8');
  expect(r.status).toBe(429);
  expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  // Outro e-mail segue entrando.
  expect((await login(DEMO.viewer.email, DEMO.viewer.password, '8.8.8.8')).status).toBe(200);
});

test('acerto zera a contagem do e-mail', async () => {
  for (let i = 0; i < EMAIL_LIMIT - 1; i++) await login(DEMO.owner.email, 'errada', '7.7.7.7');
  expect((await login(DEMO.owner.email, DEMO.owner.password, '7.7.7.7')).status).toBe(200);
  for (let i = 0; i < EMAIL_LIMIT - 1; i++) await login(DEMO.owner.email, 'errada', '7.7.7.8');
  expect((await login(DEMO.owner.email, DEMO.owner.password, '7.7.7.8')).status).toBe(200);
});

test('por IP: muitos e-mails diferentes do mesmo IP bloqueiam o IP', async () => {
  for (let i = 0; i < IP_LIMIT; i++) await login(`ninguem${i}@x.com`, 'errada', '6.6.6.6');
  expect((await login(DEMO.owner.email, DEMO.owner.password, '6.6.6.6')).status).toBe(429);
  expect((await login(DEMO.owner.email, DEMO.owner.password, '6.6.6.7')).status).toBe(200);
});

test('2ª etapa: limite por IP também vale em /auth/login/totp', async () => {
  const totp = () =>
    t.app.request('/auth/login/totp', {
      method: 'POST',
      body: JSON.stringify({ challenge: 'x', code: '000000' }),
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '5.5.5.5' },
    });
  for (let i = 0; i < IP_LIMIT; i++) expect((await totp()).status).toBe(401);
  expect((await totp()).status).toBe(429);
});

test('histórico: login certo, falhas e bloqueio da pessoa', async () => {
  const acts = await t.get<{ items: { action: string; userName: string; detail: string | null }[] }>(
    '/activities?type=security',
  );
  const actions = acts.items.map((a) => a.action);
  expect(actions).toContain('login');
  expect(actions).toContain('login_failed');
  expect(acts.items.some((a) => a.action === 'login_failed' && a.detail?.startsWith('bloqueado'))).toBe(true);
});

test('cabeçalhos de segurança na API sem quebrar o snippet entre origens', async () => {
  const h = (await t.app.request('/health')).headers;
  expect(h.get('strict-transport-security')).toContain('max-age=31536000');
  expect(h.get('x-content-type-options')).toBe('nosniff');
  expect(h.get('x-frame-options')).toBe('DENY');
  expect(h.get('content-security-policy')).toBe("frame-ancestors 'none'");
  expect(h.get('referrer-policy')).toBe('no-referrer');
  // /cdn/*.js é <script> no site do cliente: sem CORP same-origin.
  const cdn = await t.app.request('/cdn/abt.js');
  expect(cdn.status).toBe(200);
  expect(cdn.headers.get('cross-origin-resource-policy')).toBeNull();
  // CORS da API privada continua.
  const pre = await t.app.request('/projects', {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
  });
  expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
});
