import { ExperimentSchema, type PublishedConfig } from '@abtest/shared';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { banditUser } from '../bandit';
import { createPublisher } from '../publish';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
let projectId: string;
const files = new Map<string, string>();
const cdn = {
  get: async (n: string) => files.get(n) ?? (n === 'abt.js' ? '/*rt*/' : null),
  put: async (n: string, b: string) => void files.set(n, b),
};
beforeAll(async () => {
  t = await setupApp({ cdn });
  projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
});
afterEach(() => vi.unstubAllGlobals());

interface Req {
  id: string;
  status: string;
  note: string;
  requestedBy: { name: string };
  decidedBy?: { name: string };
  comment?: string;
  version?: number;
}
const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const publish = (as: string) => send('POST', '/publish', undefined, as);
const requests = (as = 'owner') => t.get<Req[]>('/publish-requests', as);
const live = () => JSON.parse(files.get(`${DEMO.accountId}.json`)!) as PublishedConfig;
const save = (id: string, name: string, allocation = 'manual', weights = [50, 50]) =>
  send('PUT', `/experiments/${id}`, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id,
      key: id,
      name,
      status: 'running',
      allocation,
      variations: [
        { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: weights[0] },
        { id: `${id}_v1`, key: 'b', name: 'B', weight: weights[1] },
      ],
    }),
  });
const approval = (on: boolean) =>
  send('PUT', '/account/settings', { heatmapSampleRate: null, requireApproval: on });

test('aprovação desligada: editor publica direto; só owner liga; configuração antiga mantém o valor', async () => {
  expect((await publish('editor')).status).toBe(200);
  expect(
    (await send('PUT', '/account/settings', { heatmapSampleRate: null, requireApproval: true }, 'editor'))
      .status,
  ).toBe(403);
  expect((await approval(true)).status).toBe(200);
  // Cliente que não manda o campo (só a amostragem) não desliga a aprovação.
  expect((await send('PUT', '/account/settings', { heatmapSampleRate: 0.5 })).status).toBe(200);
  expect(await t.get('/account/settings', 'viewer')).toEqual({
    heatmapSampleRate: 0.5,
    requireApproval: true,
  });
  await send('PUT', '/account/settings', { heatmapSampleRate: null });
});

test('com aprovação: sem mudança publica; com mudança vira pedido (um por pessoa) e nada vai ao ar', async () => {
  const before = live().version;
  expect((await publish('editor')).status).toBe(200); // nada novo: republicar o aprovado não precisa de pedido
  expect(live().version).toBe(before + 1);

  expect((await save('ap_a', 'Hero')).status).toBe(200);
  const r = await publish('editor');
  expect(r.status).toBe(202);
  const { requestId } = (await r.json()) as { requestId: string };
  expect(live().experiments.some((e) => e.id === 'ap_a')).toBe(false);
  expect(((await (await publish('editor')).json()) as { requestId: string }).requestId).toBe(requestId);

  // Recado pelo POST /publish-requests atualiza o mesmo pedido.
  const n = await send('POST', '/publish-requests', { note: 'Novo hero para a campanha' }, 'editor');
  expect(n.status).toBe(201);
  expect(((await n.json()) as Req).id).toBe(requestId);
  const [p] = await requests('viewer');
  expect(p).toMatchObject({ id: requestId, status: 'pending', note: 'Novo hero para a campanha' });
  expect(p!.requestedBy.name).toBe('Editor Demo');

  expect((await send('POST', '/publish-requests', {}, 'viewer')).status).toBe(403);
  expect((await send('POST', '/publish-requests', {})).status).toBe(400); // owner publica direto
});

test('recusar exige comentário e quem aprova; decidido não muda mais', async () => {
  const [p] = await requests();
  expect((await send('POST', `/publish-requests/${p!.id}/reject`, { comment: 'não' }, 'editor')).status).toBe(
    403,
  );
  expect((await send('POST', `/publish-requests/${p!.id}/approve`, {}, 'editor')).status).toBe(403);
  expect((await send('POST', `/publish-requests/${p!.id}/reject`, { comment: ' ' })).status).toBe(400);
  const r = await send('POST', `/publish-requests/${p!.id}/reject`, { comment: 'Falta o texto do botão' });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ status: 'rejected', comment: 'Falta o texto do botão' });
  expect((await send('POST', `/publish-requests/${p!.id}/approve`, {})).status).toBe(409);
  expect((await send('POST', `/publish-requests/${p!.id}/reject`, { comment: 'x' })).status).toBe(409);
  // Outra conta não enxerga.
  expect(await requests('other')).toEqual([]);
  expect((await send('POST', `/publish-requests/${p!.id}/approve`, {}, 'other')).status).toBe(404);
});

test('aprovar publica e leva os outros pendentes junto; webhook e atividades', async () => {
  const calls: { type: string; status?: string }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(null, { status: 200 });
  });
  await send('POST', '/entities/webhook', {
    name: 'slack',
    data: { url: 'https://hook.test/a', events: ['approval', 'publish'] },
  });
  const { requestId } = (await (await publish('editor')).json()) as { requestId: string };
  await vi.waitFor(() =>
    expect(calls).toContainEqual(expect.objectContaining({ type: 'approval', status: 'pending' })),
  );

  const ok = await send('POST', `/publish-requests/${requestId}/approve`, { comment: 'Pode ir' });
  expect(ok.status).toBe(200);
  const { version } = (await ok.json()) as { version: number };
  expect(live()).toMatchObject({ version });
  expect(live().experiments.some((e) => e.id === 'ap_a')).toBe(true);
  expect((await requests()).find((r) => r.id === requestId)).toMatchObject({
    status: 'approved',
    comment: 'Pode ir',
    version,
    decidedBy: { name: 'Dona Demo' },
  });
  await vi.waitFor(() =>
    expect(calls).toContainEqual(expect.objectContaining({ type: 'approval', status: 'approved' })),
  );
  expect(calls).toContainEqual(expect.objectContaining({ type: 'publish', version }));

  // Owner publicando direto resolve o pedido pendente (as mudanças foram ao ar).
  await save('ap_a', 'Hero 2');
  const again = (await (await publish('editor')).json()) as { requestId: string };
  expect((await publish('owner')).status).toBe(200);
  expect((await requests()).find((r) => r.id === again.requestId)?.status).toBe('approved');

  const acts = await t.get<{
    items: { action: string; targetType: string; targetName: string; detail: string | null }[];
  }>('/activities?type=publish');
  const actions = acts.items.map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(['request', 'approve', 'reject', 'publish']));
  expect(acts.items.find((a) => a.action === 'approve')).toMatchObject({
    targetName: 'Editor Demo',
    detail: `versão ${version} · Pode ir`,
  });
});

test('publicação automática (bandit) passa só com pesos novos; mudança pendente segura', async () => {
  const pub = createPublisher({ repo: t.repo, cdn, publicUrl: 'http://cdn.test' });
  await save('ap_b', 'Bandit', 'bandit');
  expect((await publish('owner')).status).toBe(200);
  await save('ap_b', 'Bandit', 'bandit', [80, 20]); // como o rebalanceamento faria
  expect(await pub(DEMO.accountId, banditUser(DEMO.accountId))).toHaveProperty('version');
  expect(live().experiments.find((e) => e.id === 'ap_b')!.variations[0]!.weight).toBe(80);

  await save('ap_b', 'Bandit renomeado', 'bandit', [70, 30]);
  expect(await pub(DEMO.accountId, banditUser(DEMO.accountId))).toMatchObject({ needsApproval: true });
  // Peso de experimento manual é mudança a aprovar.
  await save('ap_b', 'Bandit', 'bandit', [70, 30]);
  expect(await pub(DEMO.accountId, banditUser(DEMO.accountId))).toHaveProperty('version');
  await save('ap_a', 'Hero 2', 'manual', [90, 10]);
  expect(await pub(DEMO.accountId, banditUser(DEMO.accountId))).toMatchObject({ needsApproval: true });
  await approval(false);
});
