import { ExperimentSchema, type PublishedConfig } from '@abtest/shared';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createPublisher } from '../publish';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';
import { runSchedules } from './schedules';

let t: Awaited<ReturnType<typeof setupApp>>;
let projectId: string;
const files = new Map<string, string>();
const cdn = {
  get: async (n: string) => files.get(n) ?? (n === 'abt.js' ? '/*rt*/' : null),
  put: async (n: string, b: string) => void files.set(n, b),
};
const H = 3_600_000;
beforeAll(async () => {
  t = await setupApp({ cdn });
  projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
});
afterEach(() => vi.unstubAllGlobals());

interface Sched {
  id: string;
  experimentId: string;
  experimentName: string;
  action: string;
  at: string;
  createdBy: string;
}
const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const publisher = () => createPublisher({ repo: t.repo, cdn, publicUrl: 'http://cdn.test' });
const live = () => JSON.parse(files.get(`${DEMO.accountId}.json`) ?? '{"experiments":[]}') as PublishedConfig;
const status = async (id: string) => (await t.repo.getExperiment(DEMO.accountId, id))!.experiment.status;
const save = (id: string, s = 'draft') =>
  send('PUT', `/experiments/${id}`, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id,
      key: id,
      name: `Teste ${id}`,
      status: s,
      variations: [
        { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
        { id: `${id}_v1`, key: 'b', name: 'B', weight: 50 },
      ],
    }),
  });
const schedule = (id: string, action: string, at: number | string, as = 'owner') =>
  send(
    'POST',
    `/experiments/${id}/schedules`,
    { action, at: typeof at === 'string' ? at : new Date(at).toISOString() },
    as,
  );
const list = (q = '', as = 'owner') => t.get<Sched[]>(`/schedules${q}`, as);
const activities = () => t.repo.listActivities(DEMO.accountId, { limit: 20 });

test('cria, lista, edita e cancela; valida data, papel e conta', async () => {
  await save('sc_a');
  const at = Date.now() + 2 * H;
  // Data com fuso explícito é guardada em UTC.
  const r = await send('POST', '/experiments/sc_a/schedules', {
    action: 'start',
    at: new Date(at).toISOString().replace('Z', '+00:00'),
  });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  expect(await list('?experimentId=sc_a', 'viewer')).toEqual([
    expect.objectContaining({
      id,
      experimentName: 'Teste sc_a',
      action: 'start',
      at: new Date(at).toISOString(),
      createdBy: expect.any(String),
    }),
  ]);
  expect((await schedule('sc_a', 'start', Date.now() - 1000)).status).toBe(400);
  expect((await schedule('sc_a', 'start', Date.now() + 400 * 86_400_000)).status).toBe(400);
  expect((await schedule('sc_a', 'start', 'amanhã')).status).toBe(400);
  expect((await schedule('sc_a', 'start', at, 'viewer')).status).toBe(403);
  expect((await schedule('nao_existe', 'start', at)).status).toBe(404);
  // Outra conta não vê nem mexe.
  expect(await list('', 'other')).toEqual([]);
  expect((await send('DELETE', `/experiments/sc_a/schedules/${id}`, undefined, 'other')).status).toBe(404);

  const later = at + 5 * H;
  const e = await send(
    'PUT',
    `/experiments/sc_a/schedules/${id}`,
    { action: 'pause', at: new Date(later).toISOString() },
    'editor',
  );
  expect(e.status).toBe(200);
  expect((await list('?experimentId=sc_a'))[0]).toMatchObject({
    action: 'pause',
    at: new Date(later).toISOString(),
  });
  expect((await send('DELETE', `/experiments/sc_a/schedules/${id}`, undefined, 'editor')).status).toBe(204);
  expect(await list('?experimentId=sc_a')).toEqual([]);
  const acts = (await activities()).filter((a) => a.targetId === 'sc_a').map((a) => a.action);
  expect(acts).toEqual(expect.arrayContaining(['schedule', 'schedule_edit', 'schedule_cancel']));
});

test('job: só executa o vencido, muda o status, publica, registra como Agendamento e avisa por webhook', async () => {
  await save('sc_b');
  await save('sc_c', 'running');
  const now = Date.now();
  await schedule('sc_b', 'start', now + H);
  await schedule('sc_c', 'pause', now + H);
  await schedule('sc_b', 'pause', now + 3 * H);
  await send('POST', '/entities/webhook', {
    name: 'hook',
    data: { url: 'https://hook.test/x', secret: 's'.repeat(16), events: ['publish'], enabled: true },
  });
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    calls.push(String(init.body));
    return new Response('ok');
  });

  await runSchedules(t.repo, publisher(), now + 30 * 60_000); // nada vencido
  expect(await status('sc_b')).toBe('draft');

  await runSchedules(t.repo, publisher(), now + H + 60_000);
  expect(await status('sc_b')).toBe('running');
  expect(await status('sc_c')).toBe('paused');
  expect(live().experiments.map((e) => e.id)).toContain('sc_b');
  expect(live().experiments.map((e) => e.id)).not.toContain('sc_c');
  expect((await list('?experimentId=sc_b')).map((s) => s.action)).toEqual(['pause']);
  expect(calls.some((b) => JSON.parse(b).type === 'publish')).toBe(true);
  const acts = await activities();
  expect(acts.find((a) => a.targetId === 'sc_b' && a.action === 'start')).toMatchObject({
    userId: null,
    userName: 'Agendamento',
    detail: expect.stringMatching(/agendado por .* · publicado na versão \d+/),
  });
  expect(acts.some((a) => a.targetType === 'publish' && a.userName === 'Agendamento')).toBe(true);

  await runSchedules(t.repo, publisher(), now + 3 * H);
  expect(await status('sc_b')).toBe('paused');
  expect(await list()).toEqual([]);
});

test('aprovação: agendado por quem aprova vale como aprovado; por editor vira pedido', async () => {
  await send('PUT', '/account/settings', { heatmapSampleRate: null, requireApproval: true });
  await save('sc_d');
  await save('sc_e');
  const now = Date.now();
  await schedule('sc_d', 'start', now + H, 'owner');
  await runSchedules(t.repo, publisher(), now + H);
  expect(live().experiments.map((e) => e.id)).toContain('sc_d');

  await schedule('sc_e', 'start', now + 2 * H, 'editor');
  await runSchedules(t.repo, publisher(), now + 2 * H);
  expect(await status('sc_e')).toBe('running');
  expect(live().experiments.map((e) => e.id)).not.toContain('sc_e');
  const reqs =
    await t.get<{ status: string; requestedBy: { name: string }; note: string }[]>('/publish-requests');
  expect(reqs[0]).toMatchObject({
    status: 'pending',
    requestedBy: { name: 'Agendamento' },
    note: expect.stringContaining('iniciar "Teste sc_e"'),
  });
  const act = (await activities()).find((a) => a.targetId === 'sc_e' && a.action === 'start');
  expect(act?.detail).toContain('aguardando aprovação');
  await send('PUT', '/account/settings', { heatmapSampleRate: null, requireApproval: false });
});

test('experimento apagado ou arquivado: agendamento sai sem mexer em nada', async () => {
  await save('sc_f');
  await save('sc_g');
  const now = Date.now();
  await schedule('sc_f', 'start', now + H);
  await schedule('sc_g', 'start', now + H);
  await send('DELETE', '/experiments/sc_f');
  await send('PATCH', '/experiments/sc_g/status', { status: 'archived' });
  expect((await schedule('sc_g', 'start', now + H)).status).toBe(400);
  await runSchedules(t.repo, publisher(), now + H);
  expect(await status('sc_g')).toBe('archived');
  expect(await list()).toEqual([]);
});
