import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  t = await setupApp();
});

const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const bearer = (token: string) => ({ origin: 'http://localhost:5173', authorization: `Bearer ${token}` });
interface Session {
  token: string;
  user: { id: string; accountId: string; role: string; canPublishJs: boolean };
}
interface Me {
  accountId: string;
  role: string;
  accounts: { id: string; name: string; role: string }[];
}

test('login de sempre continua: conta padrão e /me com a lista de contas', async () => {
  const me = await t.get<Me>('/me');
  expect(me).toMatchObject({ accountId: DEMO.accountId, role: 'owner' });
  expect(me.accounts).toEqual([{ id: DEMO.accountId, name: 'Loja Demo', role: 'owner' }]);
});

test('convite: só owner convida; pessoa nova cria login e entra na conta com o papel do convite', async () => {
  expect((await send('POST', '/invites', { email: 'nova@x.com', role: 'editor' }, 'editor')).status).toBe(
    403,
  );
  expect((await send('POST', '/invites', { email: DEMO.viewer.email, role: 'editor' })).status).toBe(409);

  const r = await send('POST', '/invites', { email: 'Nova@X.com', role: 'editor', canPublishJs: true });
  expect(r.status).toBe(201);
  const { token } = (await r.json()) as { token: string };
  expect(token.startsWith(`inv_${DEMO.accountId}.`)).toBe(true);
  const list = await t.get<{ email: string }[]>('/invites');
  expect(list.map((i) => i.email)).toEqual(['nova@x.com']);
  expect(JSON.stringify(list)).not.toContain(token);

  const info = await t.app.request(`/auth/invites/${token}`);
  expect(await info.json()).toEqual({
    accountName: 'Loja Demo',
    email: 'nova@x.com',
    role: 'editor',
    hasUser: false,
  });
  const accept = (body: unknown) =>
    t.app.request(`/auth/invites/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await accept({ password: 'curta' })).status).toBe(400);
  expect((await accept({ password: 'senha-nova-1' })).status).toBe(400); // pessoa nova precisa de nome
  const ok = await accept({ password: 'senha-nova-1', name: 'Nova' });
  expect(ok.status).toBe(200);
  const s = (await ok.json()) as Session;
  expect(s.user).toMatchObject({ accountId: DEMO.accountId, role: 'editor', canPublishJs: true });
  expect((await t.app.request('/experiments', { headers: bearer(s.token) })).status).toBe(200);

  // Uso único: o link morre e sai da lista.
  expect((await accept({ password: 'senha-nova-1', name: 'Nova' })).status).toBe(404);
  expect(await t.get('/invites')).toEqual([]);
  const login = await t.req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'nova@x.com', password: 'senha-nova-1' }),
  });
  expect(login.status).toBe(200);
});

test('convite para quem já tem login: confirma a senha; troca de conta e login na conta preferida', async () => {
  const r = await send('POST', '/invites', { email: 'x@outra.com', role: 'viewer' });
  const { token } = (await r.json()) as { token: string };
  expect(
    ((await (await t.app.request(`/auth/invites/${token}`)).json()) as { hasUser: boolean }).hasUser,
  ).toBe(true);
  const accept = (password: string) =>
    t.app.request(`/auth/invites/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  expect((await accept('errada-123')).status).toBe(401);
  const s = (await (await accept('x12345678')).json()) as Session;
  expect(s.user).toMatchObject({ accountId: DEMO.accountId, role: 'viewer' });

  // O token antigo (conta Outra) continua valendo, agora com as duas contas.
  const me = await t.get<Me>('/me', 'other');
  expect(me.accountId).toBe(t.otherAccountId);
  expect(me.accounts.map((a) => [a.id, a.role])).toEqual([
    [t.otherAccountId, 'owner'],
    [DEMO.accountId, 'viewer'],
  ]);

  // Troca: só para conta de que é membro; o papel é o daquela conta.
  const sw = await send('POST', `/accounts/${DEMO.accountId}/switch`, undefined, 'other');
  const demo = (await sw.json()) as Session;
  expect(demo.user).toMatchObject({ accountId: DEMO.accountId, role: 'viewer' });
  expect((await t.app.request('/account/api-keys', { headers: bearer(demo.token) })).status).toBe(403);
  expect((await send('POST', `/accounts/${t.otherAccountId}/switch`, undefined, 'viewer')).status).toBe(404);

  const login = async (accountId?: string) =>
    (
      (await (
        await t.req('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'x@outra.com', password: 'x12345678', accountId }),
        })
      ).json()) as Session
    ).user.accountId;
  expect(await login()).toBe(t.otherAccountId); // padrão: a conta onde foi criado
  expect(await login(DEMO.accountId)).toBe(DEMO.accountId);
  expect(await login('conta-de-outro')).toBe(t.otherAccountId); // não é membro: ignora
});

test('membros: owner muda papel e remove; nunca sem owner; isolamento entre contas', async () => {
  const members = await t.get<{ id: string; email: string; role: string }[]>('/members');
  const id = (email: string) => members.find((m) => m.email === email)!.id;
  const owner = id(DEMO.owner.email);
  const viewer = id(DEMO.viewer.email);
  expect((await send('PUT', `/members/${viewer}`, { role: 'editor' }, 'editor')).status).toBe(403);
  expect((await send('PUT', `/members/${owner}`, { role: 'editor' })).status).toBe(400);
  expect((await send('DELETE', `/members/${owner}`)).status).toBe(400);
  expect((await send('PUT', `/members/${viewer}`, { role: 'editor', canPublishJs: true })).status).toBe(200);
  expect(await t.get<{ role: string }>('/me', 'viewer')).toMatchObject({ role: 'editor' });
  expect((await send('PUT', `/members/${viewer}`, { role: 'viewer' })).status).toBe(200);

  // Membro de outra conta não aparece nem pode ser mexido daqui.
  const outra = await t.get<{ id: string }[]>('/members', 'other');
  expect(outra.some((m) => m.id === owner)).toBe(false);
  expect((await send('PUT', `/members/${owner}`, { role: 'viewer' }, 'other')).status).toBe(404);
  expect((await send('DELETE', `/members/${owner}`, undefined, 'other')).status).toBe(404);

  // Editor pode sair da própria conta; removido perde o acesso na hora (e sem outra conta, o login some).
  const editor = id(DEMO.editor.email);
  expect((await send('DELETE', `/members/${viewer}`, undefined, 'editor')).status).toBe(403);
  expect((await send('DELETE', `/members/${editor}`, undefined, 'editor')).status).toBe(204);
  expect((await t.req('/me', { as: 'editor' })).status).toBe(401);
  expect(await t.repo.findUserByEmail(DEMO.editor.email)).toBeUndefined();
});

test('conta nova: quem cria vira owner, ganha o primeiro projeto e entra nela; dados isolados', async () => {
  expect((await send('POST', '/accounts', { name: ' ', siteUrl: 'https://n.com/' })).status).toBe(400);
  const r = await send('POST', '/accounts', { name: 'Loja Nova', siteUrl: 'https://nova.com/' });
  expect(r.status).toBe(201);
  const s = (await r.json()) as Session;
  expect(s.user).toMatchObject({ role: 'owner', canPublishJs: true });
  expect(s.user.accountId).not.toBe(DEMO.accountId);
  const get = async (path: string) =>
    (await t.app.request(path, { headers: bearer(s.token) })).json() as Promise<unknown>;
  expect(await get('/projects')).toMatchObject([{ name: 'Loja Nova', siteUrl: 'https://nova.com/' }]);
  expect(await get('/experiments')).toEqual([]);
  expect(((await get('/me')) as Me).accounts.map((a) => a.name)).toEqual(['Loja Demo', 'Loja Nova']);
  // Conta padrão no login continua a demo.
  expect((await t.get<Me>('/me')).accountId).toBe(DEMO.accountId);
});

test('chave de API não troca conta, não cria conta nem convida', async () => {
  const { key } = (await (await send('POST', '/account/api-keys', { name: 'k', role: 'editor' })).json()) as {
    key: string;
  };
  const h = { ...bearer(key), 'content-type': 'application/json' };
  const post = (path: string, body: unknown) =>
    t.app.request(path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  expect((await post('/accounts', { name: 'X', siteUrl: 'https://x.com/' })).status).toBe(403);
  expect((await post(`/accounts/${DEMO.accountId}/switch`, {})).status).toBe(404);
  expect((await post('/invites', { email: 'a@b.com', role: 'viewer' })).status).toBe(403);
});

test('convite inválido, expirado ou cancelado não abre', async () => {
  for (const bad of ['x', 'inv_', `inv_${DEMO.accountId}.nada`, 'inv_naoexiste.abc'])
    expect((await t.app.request(`/auth/invites/${bad}`)).status).toBe(404);
  const r = await send('POST', '/invites', { email: 'c@x.com', role: 'viewer' });
  const { id, token } = (await r.json()) as { id: string; token: string };
  expect((await send('DELETE', `/invites/${id}`)).status).toBe(204);
  expect((await t.app.request(`/auth/invites/${token}`)).status).toBe(404);

  const r2 = await send('POST', '/invites', { email: 'd@x.com', role: 'viewer' });
  const t2 = ((await r2.json()) as { id: string; token: string }).token;
  const inv = (await t.repo.listEntities<{ email: string }>(DEMO.accountId, 'invite')).find(
    (i) => i.data.email === 'd@x.com',
  )!;
  await t.repo.saveEntity(DEMO.accountId, {
    id: inv.id,
    kind: 'invite',
    name: inv.name,
    data: { ...inv.data, expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  expect((await t.app.request(`/auth/invites/${t2}`)).status).toBe(404);
});
