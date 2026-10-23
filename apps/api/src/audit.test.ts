import { ExperimentSchema } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import { matchPath } from './audit';
import { DEMO } from './seed';
import { setupApp } from './test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
let projectId: string;
beforeAll(async () => {
  t = await setupApp();
  projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
});

interface Act {
  userName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  detail: string | null;
  createdAt: string;
}
const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const list = async (q = '', as = 'owner') =>
  t.get<{ items: Act[]; next: string | null }>(`/activities${q}`, as);
const experiment = (id: string, status = 'draft', name = 'Hero') =>
  ExperimentSchema.parse({
    id,
    key: id,
    name,
    status,
    variations: [
      { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_v1`, key: 'b', name: 'B', weight: 50 },
    ],
  });
const body = (e: ReturnType<typeof experiment>) => ({
  projectId,
  editorUrl: 'http://localhost:5180/',
  experiment: e,
});

test('matchPath casa parâmetros e recusa formas diferentes', () => {
  expect(matchPath('/experiments/:id/status', '/experiments/a%20b/status')).toEqual({ id: 'a b' });
  expect(matchPath('/experiments/:id', '/experiments/x/status')).toBeNull();
  expect(matchPath('/publish', '/publish/')).toEqual({});
});

test('experimento: criar, salvar em sequência (uma linha), iniciar, pausar e excluir', async () => {
  expect((await send('POST', '/experiments', body(experiment('exp_a')))).status).toBe(201);
  for (const name of ['Hero 2', 'Hero 3'])
    expect((await send('PUT', '/experiments/exp_a', body(experiment('exp_a', 'draft', name)))).status).toBe(
      200,
    );
  expect((await send('PATCH', '/experiments/exp_a/status', { status: 'running' }, 'editor')).status).toBe(
    200,
  );
  expect(
    (await send('PUT', '/experiments/exp_a', body(experiment('exp_a', 'paused', 'Hero 3')))).status,
  ).toBe(200);
  expect((await send('DELETE', '/experiments/exp_a')).status).toBe(204);

  const { items } = await list('?targetId=exp_a');
  expect(items.map((a) => [a.action, a.targetName, a.userName])).toEqual([
    ['delete', 'Hero 3', 'Dona Demo'],
    ['pause', 'Hero 3', 'Dona Demo'],
    ['start', 'Hero 3', 'Editor Demo'],
    ['update', 'Hero 3', 'Dona Demo'], // dois salvamentos seguidos viram uma linha
    ['create', 'Hero', 'Dona Demo'],
  ]);
  expect(items.every((a) => a.targetType === 'experiment')).toBe(true);
});

test('falha e leitura não entram; outra conta não vê', async () => {
  const before = (await list()).items.length;
  expect((await send('DELETE', '/experiments/nao-existe')).status).toBe(404);
  expect((await send('POST', '/experiments', body(experiment('exp_v')), 'viewer')).status).toBe(403);
  await t.get('/experiments');
  expect((await list()).items.length).toBe(before);
  // Só o login da própria pessoa (20.6).
  expect((await list('', 'other')).items.map((a) => a.action)).toEqual(['login']);
});

test('entidades, publicação, equipe e chave de API; filtros por pessoa e tipo', async () => {
  const funnel = {
    steps: [
      { type: 'event', name: 'Carrinho', event: 'cart' },
      { type: 'event', name: 'Compra', event: 'buy' },
    ],
  };
  const r = await send('POST', '/entities/funnel', { name: 'Compra', data: funnel }, 'editor');
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  expect((await send('DELETE', `/entities/funnel/${id}`, undefined, 'editor')).status).toBe(204);
  expect((await send('POST', '/publish')).status).toBe(200);
  expect((await send('POST', '/invites', { email: 'conv@x.com', role: 'viewer' })).status).toBe(201);
  const key = await send('POST', '/account/api-keys', { name: 'CI', role: 'editor' });
  expect(key.status).toBe(201);
  const apiKey = ((await key.json()) as { key: string }).key;
  // Escrita com chave de API: aparece com o nome da chave.
  const viaKey = await t.app.request('/experiments', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body(experiment('exp_k', 'draft', 'Via chave'))),
  });
  expect(viaKey.status).toBe(201);

  const editor = (await t.get<{ id: string; email: string }[]>('/members')).find(
    (m) => m.email === DEMO.editor.email,
  )!;
  const byEditor = await list(`?userId=${editor.id}&type=funnel`);
  expect(byEditor.items.map((a) => [a.action, a.targetName])).toEqual([
    ['delete', 'Compra'],
    ['create', 'Compra'],
  ]);
  const all = (await list()).items;
  expect(all[0]).toMatchObject({ userName: 'Chave de API: CI', action: 'create', targetName: 'Via chave' });
  expect(all.find((a) => a.targetType === 'publish')?.targetName).toMatch(/^versão \d+$/);
  expect(all.find((a) => a.targetType === 'invite')).toMatchObject({
    targetName: 'conv@x.com',
    detail: 'viewer',
  });
  expect(all.find((a) => a.targetType === 'apikey')).toMatchObject({ targetName: 'CI', detail: 'editor' });
});

test('paginação com next', async () => {
  const p1 = await list('?limit=2');
  expect(p1.items).toHaveLength(2);
  expect(p1.next).toBe(p1.items[1]!.createdAt);
  const p2 = await list(`?limit=2&before=${encodeURIComponent(p1.next!)}`);
  expect(p2.items[0]!.createdAt < p1.next!).toBe(true);
  expect((await send('GET', '/activities?limit=0')).status).toBe(400);
});

test('repo: salvamentos só se juntam dentro de 10 min', async () => {
  const acc = (await t.repo.createAccount('Janela')).id;
  const a = {
    userId: 'u1',
    userName: 'U',
    action: 'update',
    targetType: 'experiment',
    targetId: 'e1',
    targetName: 'E',
  };
  const t0 = Date.UTC(2026, 0, 1);
  await t.repo.logActivity(acc, a, t0);
  await t.repo.logActivity(acc, a, t0 + 5 * 60_000);
  expect(await t.repo.listActivities(acc)).toHaveLength(1);
  await t.repo.logActivity(acc, a, t0 + 16 * 60_000);
  await t.repo.logActivity(acc, { ...a, userId: 'u2' }, t0 + 17 * 60_000);
  const rows = await t.repo.listActivities(acc);
  expect(rows).toHaveLength(3);
  expect(rows[2]!.createdAt).toBe(new Date(t0 + 5 * 60_000).toISOString());
});

test('aceite de convite (rota sem login) e mudança de papel', async () => {
  const r = await send('POST', '/invites', { email: 'entra@x.com', role: 'editor' });
  const { token } = (await r.json()) as { token: string };
  const ok = await t.app.request(`/auth/invites/${token}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'senha-nova-1', name: 'Entrante' }),
  });
  expect(ok.status).toBe(200);
  const { user } = (await ok.json()) as { user: { id: string } };
  expect((await send('PUT', `/members/${user.id}`, { role: 'viewer' })).status).toBe(200);
  const { items } = await list(`?type=member`);
  expect(items.slice(0, 2).map((a) => [a.userName, a.action, a.targetName, a.detail])).toEqual([
    ['Dona Demo', 'role', 'Entrante', 'viewer'],
    ['Entrante', 'join', 'Entrante', 'editor'],
  ]);
});
