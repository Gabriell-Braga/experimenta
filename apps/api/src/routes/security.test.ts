import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import type { SsoProvider } from '../sso';
import { setupApp } from '../test-app';
import { base32Decode, hotp, stepAt } from '../totp';

let t: Awaited<ReturnType<typeof setupApp>>;
/** Provedor de SSO de mentira: o IdP "autentica" quem vier em `?email=`. */
const fakeSso: SsoProvider = {
  authorize: async (_cfg, p) => `https://idp.test/auth?state=${encodeURIComponent(p.state)}`,
  verify: async (_cfg, p) => {
    if (!p.query.email) throw new Error('recusado');
    return { email: p.query.email };
  },
};
beforeAll(async () => {
  t = await setupApp({ sso: { oidc: fakeSso } });
});

const ORIGIN = 'http://localhost:5173';
const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const bearer = (token: string) => ({ origin: ORIGIN, authorization: `Bearer ${token}` });
const withToken = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  t.app.request(path, {
    method: init.method ?? 'GET',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
/** Código do app autenticador `offset` passos de 30 s à frente. */
const code = (secret: string, offset = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);
const login = async (cred: { email: string; password: string }) =>
  (await (await send('POST', '/auth/login', cred)).json()) as {
    token?: string;
    mfa?: string;
    challenge?: string;
  };
const second = (challenge: string, c: string) => send('POST', '/auth/login/totp', { challenge, code: c });

/** Ativa o TOTP de quem está em `as` e devolve o segredo e os códigos de recuperação. */
async function enable(as: string) {
  const setup = (await (await send('POST', '/me/totp/setup', undefined, as)).json()) as {
    secret: string;
    uri: string;
  };
  const r = await send('POST', '/me/totp/enable', { code: await code(setup.secret) }, as);
  expect(r.status).toBe(200);
  return { secret: setup.secret, uri: setup.uri, ...((await r.json()) as { recoveryCodes: string[] }) };
}

test('duas etapas: configura, ativa e o login passa a pedir o código (replay, recuperação, bloqueio)', async () => {
  expect(await t.get('/me/totp', 'editor')).toEqual({
    enabled: false,
    recoveryCodesLeft: 0,
    required: false,
  });
  const setup = (await (await send('POST', '/me/totp/setup', undefined, 'editor')).json()) as {
    secret: string;
    uri: string;
  };
  expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(setup.uri).toContain(`secret=${setup.secret}`);
  expect(setup.uri).toContain(encodeURIComponent(DEMO.editor.email));
  expect((await send('POST', '/me/totp/enable', { code: '000000' }, 'editor')).status).toBe(400);
  const r = await send('POST', '/me/totp/enable', { code: await code(setup.secret) }, 'editor');
  const { recoveryCodes } = (await r.json()) as { recoveryCodes: string[] };
  expect(recoveryCodes).toHaveLength(10);
  // O segredo nunca volta depois de confirmado; setup de novo é recusado.
  const status = await t.get('/me/totp', 'editor');
  expect(status).toEqual({ enabled: true, recoveryCodesLeft: 10, required: false });
  expect(JSON.stringify(await t.get('/me', 'editor'))).not.toContain(setup.secret);
  expect(JSON.stringify(await t.get('/members'))).not.toContain(setup.secret);
  expect((await send('POST', '/me/totp/setup', undefined, 'editor')).status).toBe(409);
  // A sessão aberta antes continua valendo.
  expect((await send('GET', '/experiments', undefined, 'editor')).status).toBe(200);

  // Login: senha certa só devolve o desafio, que não serve de token.
  const l = await login(DEMO.editor);
  expect(l).toEqual({ mfa: 'totp', challenge: expect.any(String) });
  expect((await withToken(l.challenge!, '/me')).status).toBe(401);
  expect((await second('lixo', await code(setup.secret, 1))).status).toBe(401);
  expect((await second(l.challenge!, '123456')).status).toBe(401);
  const c1 = await code(setup.secret, 1);
  const ok = await second(l.challenge!, c1);
  expect(ok.status).toBe(200);
  const s = (await ok.json()) as { token: string; user: { role: string } };
  expect(s.user.role).toBe('editor');
  expect((await withToken(s.token, '/experiments')).status).toBe(200);
  // O mesmo código não vale duas vezes.
  expect((await second((await login(DEMO.editor)).challenge!, c1)).status).toBe(401);
  // Código de recuperação: vale uma vez, em qualquer formato.
  const rc = recoveryCodes[0]!;
  expect((await second((await login(DEMO.editor)).challenge!, rc.toLowerCase())).status).toBe(200);
  expect((await second((await login(DEMO.editor)).challenge!, rc)).status).toBe(401);
  expect(await t.get('/me/totp', 'editor')).toMatchObject({ recoveryCodesLeft: 9 });

  // 5 erros seguidos bloqueiam por 15 min, até com o código certo.
  const ch = (await login(DEMO.editor)).challenge!;
  for (let i = 0; i < 5; i++) await second(ch, '000000');
  expect((await second(ch, recoveryCodes[1]!)).status).toBe(429);
  const person = (await t.repo.findUserByEmail(DEMO.editor.email))!;
  await t.repo.setMfa(person.id, { ...person.mfa!, lockedUntil: 0 });
  expect((await second(ch, recoveryCodes[1]!)).status).toBe(200);

  // Novos códigos de recuperação: os antigos param de valer.
  const fresh = await send('POST', '/me/totp/recovery-codes', { code: recoveryCodes[2] }, 'editor');
  const { recoveryCodes: novos } = (await fresh.json()) as { recoveryCodes: string[] };
  expect(novos).toHaveLength(10);
  expect((await second((await login(DEMO.editor)).challenge!, recoveryCodes[3]!)).status).toBe(401);

  // Desativar pede senha e código.
  expect(
    (await send('POST', '/me/totp/disable', { password: 'errada', code: novos[0] }, 'editor')).status,
  ).toBe(401);
  expect(
    (await send('POST', '/me/totp/disable', { password: DEMO.editor.password, code: novos[0] }, 'editor'))
      .status,
  ).toBe(200);
  expect((await login(DEMO.editor)).token).toBeTruthy();

  // Auditoria: ativar, novos códigos e desativar ficam no histórico.
  const acts = await t.get<{ items: { action: string; targetType: string }[] }>('/activities?type=security');
  expect(acts.items.map((a) => a.action)).toEqual(['totp_off', 'recovery_codes', 'totp_on']);
});

test('sessões ativas: lista, encerra uma, sai de todos os outros e sai desta', async () => {
  const a = (await login(DEMO.viewer)).token!;
  const b = (await login(DEMO.viewer)).token!;
  const list = (await (await withToken(a, '/sessions')).json()) as { id: string; current: boolean }[];
  expect(list.length).toBeGreaterThanOrEqual(3); // setupApp + a + b
  expect(list.filter((s) => s.current)).toHaveLength(1);
  expect(list[0]).toMatchObject({ accountName: 'Loja Demo' });

  // Encerrar uma sessão pelo id derruba o token dela na hora; de outra pessoa → 404.
  const bId = ((await (await withToken(b, '/sessions')).json()) as { id: string; current: boolean }[]).find(
    (s) => s.current,
  )!.id;
  expect((await send('DELETE', `/sessions/${bId}`)).status).toBe(404);
  expect((await withToken(a, `/sessions/${bId}`, { method: 'DELETE' })).status).toBe(204);
  expect((await withToken(b, '/me')).status).toBe(401);

  // Sair de todos os outros: só esta continua.
  const r = await withToken(a, '/sessions', { method: 'DELETE' });
  expect(((await r.json()) as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
  expect((await send('GET', '/me', undefined, 'viewer')).status).toBe(401);
  expect((await (await withToken(a, '/sessions')).json()) as unknown[]).toHaveLength(1);
  // Sair desta (logout de verdade): o token para de valer.
  expect((await withToken(a, '/sessions/current', { method: 'DELETE' })).status).toBe(204);
  expect((await withToken(a, '/me')).status).toBe(401);

  // Token sem sessão (formato antigo) não entra mais.
  const { sign } = await import('hono/jwt');
  const old = await sign({ sub: 'x', acc: DEMO.accountId, exp: Math.floor(Date.now() / 1000) + 60 }, 'teste');
  expect((await withToken(old, '/me')).status).toBe(401);

  const acts = await t.get<{ items: { action: string }[] }>('/activities?type=session');
  expect(acts.items.map((x) => x.action)).toEqual(['revoke_all', 'revoke']);
});

test('conta exige duas etapas: owner precisa ter; quem não tem só configura; chave de API segue', async () => {
  const key = (
    (await (await send('POST', '/account/api-keys', { name: 'k', role: 'viewer' })).json()) as { key: string }
  ).key;
  expect((await send('PUT', '/account/security', { requireTotp: true })).status).toBe(400);
  expect((await send('PUT', '/account/security', { requireTotp: true }, 'editor')).status).toBe(403);
  const owner = await enable('owner');
  expect(owner.uri.startsWith('otpauth://totp/')).toBe(true);
  expect((await send('PUT', '/account/security', { requireTotp: true })).status).toBe(200);
  const sec = await t.get<{ requireTotp: boolean; withoutTotp: { email: string }[] }>('/account/security');
  expect(sec.requireTotp).toBe(true);
  expect(sec.withoutTotp.map((m) => m.email)).toContain(DEMO.editor.email);
  expect(sec.withoutTotp.map((m) => m.email)).not.toContain(DEMO.owner.email);

  // Editor sem TOTP: o resto da API responde 403 totp_required; /me e a configuração funcionam.
  const editor = (await login(DEMO.editor)).token!;
  const blocked = await withToken(editor, '/experiments');
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toMatchObject({ code: 'totp_required' });
  expect(await (await withToken(editor, '/me')).json()).toMatchObject({
    totpRequired: true,
    totpEnabled: false,
  });
  const setup = (await (await withToken(editor, '/me/totp/setup', { method: 'POST' })).json()) as {
    secret: string;
  };
  expect(
    (await withToken(editor, '/me/totp/enable', { method: 'POST', body: { code: await code(setup.secret) } }))
      .status,
  ).toBe(200);
  expect((await withToken(editor, '/experiments')).status).toBe(200);
  expect(await (await withToken(editor, '/me')).json()).toMatchObject({
    totpRequired: false,
    totpEnabled: true,
  });
  // Com a conta exigindo, não dá para desativar.
  expect(
    (
      await withToken(editor, '/me/totp/disable', {
        method: 'POST',
        body: { password: DEMO.editor.password, code: await code(setup.secret, 1) },
      })
    ).status,
  ).toBe(400);
  // Chave de API não é pessoa: segue funcionando.
  expect((await withToken(key, '/experiments')).status).toBe(200);

  expect((await send('PUT', '/account/security', { requireTotp: false })).status).toBe(200);
  const acts = await t.get<{ items: { targetName: string; detail: string }[] }>('/activities?type=settings');
  expect(acts.items[0]).toMatchObject({ targetName: 'Segurança da conta', detail: 'duas etapas opcional' });
});

test('convite para login com duas etapas pede o código', async () => {
  const other = await enable('other');
  const { token } = (await (
    await send('POST', '/invites', { email: 'x@outra.com', role: 'viewer' })
  ).json()) as {
    token: string;
  };
  expect(await (await t.app.request(`/auth/invites/${token}`)).json()).toMatchObject({ hasTotp: true });
  const accept = (body: unknown) =>
    t.app.request(`/auth/invites/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await accept({ password: 'x12345678' })).status).toBe(401);
  expect((await accept({ password: 'x12345678', code: other.recoveryCodes[0] })).status).toBe(200);
});

test('SSO: configuração por conta sem devolver o segredo; fluxo start → IdP → callback abre sessão', async () => {
  expect((await send('GET', '/account/sso', undefined, 'editor')).status).toBe(403);
  expect(await t.get('/account/sso')).toEqual({ config: null, hasClientSecret: false, available: ['oidc'] });
  const cfg = {
    enabled: true,
    protocol: 'oidc',
    domains: ['Abtest.dev'],
    issuer: 'https://idp.test',
    clientId: 'cli',
    clientSecret: 'segredo-do-idp',
  };
  expect((await send('PUT', '/account/sso', { ...cfg, protocol: 'saml' })).status).toBe(400); // indisponível
  expect((await send('PUT', '/account/sso', { ...cfg, clientSecret: undefined })).status).toBe(400);
  const saved = await send('PUT', '/account/sso', cfg);
  expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain('segredo-do-idp');
  // Segredo omitido mantém o anterior.
  expect((await send('PUT', '/account/sso', { ...cfg, clientSecret: undefined })).status).toBe(200);
  const got = await t.get<{ config: { domains: string[] }; hasClientSecret: boolean }>('/account/sso');
  expect(got).toMatchObject({ hasClientSecret: true, config: { domains: ['abtest.dev'] } });
  expect(JSON.stringify(got)).not.toContain('segredo-do-idp');

  // Início: só para origens do editor; vai para o IdP com o state assinado.
  expect((await t.app.request(`/auth/sso/${DEMO.accountId}/start?origin=https://mal.com`)).status).toBe(400);
  expect((await t.app.request(`/auth/sso/nao-existe/start?origin=${ORIGIN}`)).status).toBe(404);
  const start = await t.app.request(`/auth/sso/${DEMO.accountId}/start?origin=${ORIGIN}`);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

  const cb = (q: string) => t.app.request(`/auth/sso/${DEMO.accountId}/callback?${q}`);
  expect((await cb(`state=lixo&email=${DEMO.viewer.email}`)).status).toBe(400);
  expect((await t.app.request(`/auth/sso/outra/callback?state=${state}`)).status).toBe(400);
  const refused = await cb(`state=${state}`);
  expect(refused.headers.get('location')).toContain('#sso_error=');
  const stranger = await cb(`state=${state}&email=x@outra.com.br`);
  expect(stranger.headers.get('location')).toContain('#sso_error=');
  const ok = await cb(`state=${state}&email=${DEMO.viewer.email}`);
  const loc = ok.headers.get('location')!;
  expect(loc.startsWith(`${ORIGIN}/#sso=`)).toBe(true);
  const token = decodeURIComponent(loc.split('#sso=')[1]!);
  expect(await (await withToken(token, '/me')).json()).toMatchObject({ email: DEMO.viewer.email });
});
