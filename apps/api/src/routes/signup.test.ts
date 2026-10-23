import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import { APP_ORIGIN, setupApp } from '../test-app';

// Tarefa 20.4 (D-099): sessão em cookie httpOnly + CSRF, URL alvo, cadastro e recuperação de senha.
let t: Awaited<ReturnType<typeof setupApp>>;
const mails: { to: string; text: string }[] = [];
beforeAll(async () => {
  t = await setupApp({
    sendMail: async (to, _subject, text) => {
      mails.push({ to, text });
    },
  });
});

const raw = (path: string, init: RequestInit & { ip?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.ip) headers.set('x-forwarded-for', init.ip);
  return t.app.request(path, { ...init, headers });
};
const EDITOR = { origin: APP_ORIGIN, 'x-requested-with': 'abt' };
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

test('login do editor: cookie httpOnly sem token no corpo; Bearer continua para clientes de API', async () => {
  const r = await raw('/auth/login', { method: 'POST', headers: EDITOR, body: JSON.stringify(DEMO.owner) });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { token?: string; user: { email: string } };
  expect(body.token).toBeUndefined();
  expect(body.user.email).toBe(DEMO.owner.email);
  const set = r.headers.get('set-cookie') ?? '';
  expect(set).toMatch(/^abt_session=/);
  expect(set).toMatch(/HttpOnly/i);
  expect(set).toMatch(/SameSite=Lax/i); // http (dev); em https: None; Secure; Partitioned
  expect(r.headers.get('access-control-allow-credentials')).toBe('true');

  const cookie = cookieOf(r);
  const me = await raw('/me', { headers: { cookie, origin: APP_ORIGIN } });
  expect(me.status).toBe(200);

  // Sem o header do editor: token no corpo, sem cookie (SDK, scripts, testes).
  const api = await raw('/auth/login', { method: 'POST', body: JSON.stringify(DEMO.owner) });
  expect(((await api.json()) as { token?: string }).token).toBeTruthy();
  expect(api.headers.get('set-cookie')).toBeNull();
});

test('https: cookie SameSite=None; Secure; Partitioned', async () => {
  const r = await raw('https://api.test/auth/login', {
    method: 'POST',
    headers: EDITOR,
    body: JSON.stringify(DEMO.owner),
  });
  const set = r.headers.get('set-cookie') ?? '';
  expect(set).toMatch(/Secure/);
  expect(set).toMatch(/SameSite=None/i);
  expect(set).toMatch(/Partitioned/);
});

test('CSRF: escrita por cookie exige o header do editor e Origin autorizado; Bearer não precisa', async () => {
  const login = await raw('/auth/login', {
    method: 'POST',
    headers: EDITOR,
    body: JSON.stringify(DEMO.owner),
  });
  const cookie = cookieOf(login);
  const body = JSON.stringify({ name: 'P', siteUrl: 'https://p.com' });
  // Formulário de outro site: sem header customizado.
  expect((await raw('/projects', { method: 'POST', headers: { cookie }, body })).status).toBe(403);
  expect(
    (
      await raw('/projects', {
        method: 'POST',
        headers: { cookie, 'x-requested-with': 'abt', origin: 'https://mal.com' },
        body,
      })
    ).status,
  ).toBe(403);
  expect((await raw('/projects', { method: 'POST', headers: { cookie, ...EDITOR }, body })).status).toBe(201);
  // Leitura por cookie não precisa do header.
  expect((await raw('/projects', { headers: { cookie } })).status).toBe(200);
  // Bearer (API) segue sem header.
  expect((await t.req('/projects', { method: 'POST', as: 'owner', body })).status).toBe(201);

  // Sair encerra a sessão e apaga o cookie.
  const out = await raw('/sessions/current', { method: 'DELETE', headers: { cookie, ...EDITOR } });
  expect(out.status).toBe(204);
  expect(out.headers.get('set-cookie')).toMatch(/abt_session=;.*Max-Age=0/i);
  expect((await raw('/me', { headers: { cookie } })).status).toBe(401);
});

test('URL alvo: só nos sites do workspace, sem dado pessoal; localhost vale', async () => {
  const [project] = await t.get<{ id: string }[]>('/projects');
  const exp = (id: string) => ({
    id,
    key: id.replace('_', '-'),
    name: id,
    variations: [
      { id: `${id}_a`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'B', weight: 50 },
    ],
  });
  const save = (editorUrl: string, id: string) =>
    t.req('/experiments', {
      method: 'POST',
      as: 'editor',
      body: JSON.stringify({ projectId: project!.id, editorUrl, experiment: exp(id) }),
    });
  const err = async (r: Response) => ((await r.json()) as { error: string }).error;

  const yt = await save('https://www.youtube.com/watch?v=1', 'exp_yt');
  expect(yt.status).toBe(400);
  expect(await err(yt)).toContain('não é um site deste workspace');
  const pii = await save(
    'http://localhost:5180/?nome=Ana&email=ana%40x.com&tel=%2B55%2011%2099999-0000',
    'exp_pii',
  );
  expect(pii.status).toBe(400);
  expect(await err(pii)).toContain('nome, email, tel');
  expect((await save('javascript:alert(1)//localhost', 'exp_js')).status).toBe(400);
  expect((await save('http://localhost:5180/loja/?utm_source=x&id=12345678', 'exp_ok')).status).toBe(201);

  // Site cadastrado no workspace (e subdomínio dele) vale.
  await t.req('/projects', {
    method: 'POST',
    as: 'owner',
    body: JSON.stringify({ name: 'Loja', siteUrl: 'https://www.minhaloja.com.br/' }),
  });
  expect((await save('https://checkout.minhaloja.com.br/pagar', 'exp_sub')).status).toBe(201);
});

test('cadastro: senha de 10+, cria workspace como owner e entra; e-mail repetido = 409', async () => {
  const body = {
    name: 'Bia',
    email: 'bia@nova.com',
    password: 'curta',
    workspace: 'Loja da Bia',
    siteUrl: 'https://bia.com',
  };
  const ip = '10.0.0.1';
  const short = await raw('/auth/signup', { method: 'POST', ip, body: JSON.stringify(body) });
  expect(short.status).toBe(400);
  expect(await short.text()).toContain('10 caracteres');

  const ok = await raw('/auth/signup', {
    method: 'POST',
    ip,
    headers: EDITOR,
    body: JSON.stringify({ ...body, password: 'senha-forte-1' }),
  });
  expect(ok.status).toBe(201);
  const s = (await ok.json()) as { token?: string; user: { role: string; accountId: string } };
  expect(s.token).toBeUndefined();
  expect(s.user.role).toBe('owner');
  const cookie = cookieOf(ok);
  const projects = (await (await raw('/projects', { headers: { cookie } })).json()) as { siteUrl: string }[];
  expect(projects.map((p) => p.siteUrl)).toEqual(['https://bia.com']);
  // Workspace novo sem escolha salva: publica esperando consentimento.
  const pub = await raw('/publish', { method: 'POST', headers: { cookie, ...EDITOR } });
  expect(pub.status).toBe(200);

  const again = await raw('/auth/signup', {
    method: 'POST',
    ip,
    body: JSON.stringify({ ...body, password: 'senha-forte-1' }),
  });
  expect(again.status).toBe(409);
});

test('cadastro: limite por IP', async () => {
  const body = JSON.stringify({ name: 'x', email: 'no', password: 'x', workspace: 'x', siteUrl: 'x' });
  const codes: number[] = [];
  for (let i = 0; i < 6; i++)
    codes.push((await raw('/auth/signup', { method: 'POST', ip: '10.9.9.9', body })).status);
  expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
  expect(codes[5]).toBe(429);
});

test('esqueci a senha: mesma resposta para e-mail com e sem login; token de uso único e ligado à senha', async () => {
  const forgot = (email: string) =>
    raw('/auth/password/forgot', {
      method: 'POST',
      ip: '10.1.1.1',
      headers: { origin: APP_ORIGIN },
      body: JSON.stringify({ email }),
    });
  const a = await forgot('ninguem@x.com');
  const b = await forgot(DEMO.viewer.email);
  expect(a.status).toBe(200);
  expect(await a.text()).toBe(await b.text());
  expect(mails.map((m) => m.to)).toEqual([DEMO.viewer.email]);
  const link = mails[0]!.text.match(/https?:\/\/\S+/)![0];
  expect(link.startsWith(`${APP_ORIGIN}/?reset=`)).toBe(true);
  const token = decodeURIComponent(link.split('reset=')[1]!);

  const reset = (password: string, tk = token) =>
    raw('/auth/password/reset', {
      method: 'POST',
      ip: '10.1.1.2',
      body: JSON.stringify({ token: tk, password }),
    });
  expect((await reset('curta')).status).toBe(400);
  expect((await reset('nova-senha-123', token + 'x')).status).toBe(400);
  expect((await reset('nova-senha-123')).status).toBe(200);
  // Uso único: a senha mudou, o token morreu.
  expect((await reset('outra-senha-123')).status).toBe(400);
  // Sessões antigas encerradas; a senha nova entra.
  expect((await t.req('/me', { as: 'viewer' })).status).toBe(401);
  const login = await raw('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: DEMO.viewer.email, password: 'nova-senha-123' }),
  });
  expect(login.status).toBe(200);
});
