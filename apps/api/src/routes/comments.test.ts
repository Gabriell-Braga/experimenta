import { ExperimentSchema } from '@abtest/shared';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const ids: Record<string, string> = {};
let survey: string;
beforeAll(async () => {
  t = await setupApp();
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id: 'cm_exp',
      key: 'cm_exp',
      name: 'Hero novo',
      variations: [{ id: 'cm_v0', key: 'controle', name: 'Controle', weight: 100 }],
    }),
  });
  survey = await t.repo.saveEntity(DEMO.accountId, { kind: 'survey', name: 'NPS', data: {} });
  await t.repo.saveEntity(DEMO.accountId, {
    kind: 'ai-ideas',
    name: 'ideias',
    data: { status: 'done', ideas: [{ id: 'idea_1', title: 'Frete grátis no topo' }] },
  });
  for (const m of await t.repo.listMembers(DEMO.accountId)) ids[m.role] = m.id;
});
afterEach(() => vi.unstubAllGlobals());

interface C {
  id: string;
  body: string;
  userName: string;
  targetName: string;
  mentions: { id: string; name: string }[];
}
const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const post = (b: Record<string, unknown>, as = 'owner') =>
  send('POST', '/comments', { targetType: 'experiment', targetId: 'cm_exp', ...b }, as);
const list = (type: string, id: string, as = 'owner') =>
  t.get<C[]>(`/comments?targetType=${type}&targetId=${id}`, as);

test('qualquer membro comenta (viewer também); conversa em ordem; texto guardado como veio', async () => {
  const a = await post({ body: '  <b>Olá</b> @Edu  ', mentions: [ids.editor] }, 'viewer');
  expect(a.status).toBe(201);
  expect(await a.json()).toMatchObject({
    body: '<b>Olá</b> @Edu',
    targetName: 'Hero novo',
    mentions: [{ id: ids.editor }],
  });
  expect((await post({ body: 'segunda' }, 'editor')).status).toBe(201);
  expect((await list('experiment', 'cm_exp')).map((c) => c.body)).toEqual(['<b>Olá</b> @Edu', 'segunda']);
  // Validação: texto vazio, alvo inexistente, tipo desconhecido.
  expect((await post({ body: '   ' })).status).toBe(400);
  expect((await post({ body: 'x', targetId: 'nao_existe' })).status).toBe(404);
  expect((await post({ body: 'x', targetType: 'project' })).status).toBe(400);
});

test('menção só de membro da conta; mencionado vê em /comments/mentions; webhook avisa', async () => {
  const calls: { type: string; mentioned?: { id: string }[] }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(null, { status: 200 });
  });
  await send('POST', '/entities/webhook', {
    name: 'slack',
    data: { url: 'https://hook.test/m', events: ['mention'] },
  });
  const [stranger] = await t.repo.listMembers(t.otherAccountId);
  expect((await post({ body: 'oi', mentions: [stranger!.id] })).status).toBe(400);
  expect((await post({ body: 'oi', mentions: ['usr_inventado'] })).status).toBe(400);

  const r = await send('POST', '/comments', {
    targetType: 'survey',
    targetId: survey,
    body: 'Olha isso @Viewer',
    mentions: [ids.viewer, ids.viewer],
  });
  expect(r.status).toBe(201);
  const mentions = await t.get<C[]>('/comments/mentions', 'viewer');
  expect(mentions[0]).toMatchObject({ body: 'Olha isso @Viewer', targetName: 'NPS' });
  expect(mentions[0]!.mentions).toHaveLength(1);
  expect(await t.get<C[]>('/comments/mentions', 'other')).toEqual([]);
  await vi.waitFor(() =>
    expect(calls).toContainEqual(
      expect.objectContaining({ type: 'mention', mentioned: [expect.objectContaining({ id: ids.viewer })] }),
    ),
  );
});

test('ideias e pop-ups como alvo; outra conta não lê nem comenta', async () => {
  expect(
    (await send('POST', '/comments', { targetType: 'idea', targetId: 'idea_1', body: 'boa' })).status,
  ).toBe(201);
  expect((await list('idea', 'idea_1'))[0]).toMatchObject({ targetName: 'Frete grátis no topo' });
  expect(
    (await send('POST', '/comments', { targetType: 'idea', targetId: 'idea_x', body: 'x' })).status,
  ).toBe(404);
  expect(await list('experiment', 'cm_exp', 'other')).toEqual([]);
  expect((await post({ body: 'invasão' }, 'other')).status).toBe(404);
});

test('exclui quem escreveu ou owner; exclusão entra nas atividades do item', async () => {
  const mine = (await (await post({ body: 'do editor' }, 'editor')).json()) as C;
  expect((await send('DELETE', `/comments/${mine.id}`, undefined, 'viewer')).status).toBe(403);
  expect((await send('DELETE', `/comments/${mine.id}`, undefined, 'other')).status).toBe(404);
  expect((await send('DELETE', `/comments/${mine.id}`, undefined, 'editor')).status).toBe(200);
  const other = (await (await post({ body: 'do viewer' }, 'viewer')).json()) as C;
  expect((await send('DELETE', `/comments/${other.id}`)).status).toBe(200);
  expect((await list('experiment', 'cm_exp')).map((c) => c.body)).not.toContain('do viewer');
  const { items } = await t.get<{ items: { action: string; targetType: string }[] }>(
    '/activities?targetId=cm_exp',
  );
  expect(items.filter((a) => a.targetType === 'comment' && a.action === 'delete')).toHaveLength(2);
});
