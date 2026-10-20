import { ExperimentSchema } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import type { Attribution } from '../analytics/attribution';
import { DEMO } from '../seed';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const DAY = 86_400_000;
const S = 'http://localhost:5180/';
type Res = Attribution & { events: { key: string; count: number }[]; variations?: { id: string }[] };

beforeAll(async () => {
  t = await setupApp();
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId,
    editorUrl: S,
    experiment: ExperimentSchema.parse({
      id: 'exp_attr',
      key: 'attr',
      name: 'Atribuição',
      status: 'running',
      variations: [
        { id: 'a0', key: 'controle', name: 'Controle', weight: 50 },
        { id: 'a1', key: 'b', name: 'B', weight: 50 },
      ],
      goals: [{ id: 'g_buy', key: 'compra', type: 'custom', event: 'compra' }],
    }),
  });
  const now = Date.now();
  const pv = (visitorId: string, sessionId: string, ts: number, url = S, referrer?: string) =>
    ev({ type: 'pageview', visitorId, sessionId, ts, url, referrer, device: 'desktop' } as never);
  const buy = (visitorId: string, ts: number, value: number, variationId: string) => [
    ev({ type: 'event', visitorId, ts, name: 'compra', value } as never),
    ev({
      type: 'conversion',
      visitorId,
      ts,
      experimentId: 'exp_attr',
      experimentKey: 'attr',
      variationId,
      variationKey: 'x',
      goalId: 'g_buy',
      goalKey: 'compra',
      value,
    } as never),
  ];
  const r = await t.collect([
    // v1: chega pelo Instagram (UTM), volta pelo e-mail e compra numa visita direta.
    pv('v1', 's1', now - 3 * DAY, `${S}?utm_source=instagram&utm_medium=social&utm_campaign=verao`),
    pv('v1', 's2', now - 2 * DAY, `${S}?utm_source=news&utm_medium=email&utm_campaign=outubro`),
    pv('v1', 's3', now - DAY),
    ...buy('v1', now - DAY + 1000, 300, 'a1'),
    // v2: busca orgânica, compra na mesma visita.
    pv('v2', 's4', now - DAY, S, 'https://www.google.com/'),
    ...buy('v2', now - DAY + 1000, 100, 'a0'),
    // Evento sem valor não entra no padrão; QA nunca entra.
    ev({ type: 'event', visitorId: 'v2', name: 'cadastro' } as never),
    ev({ type: 'event', visitorId: 'qa', name: 'compra', value: 999, qa: true } as never),
  ]);
  expect(r.status).toBe(204);
});

const keys = (rows: { key: string; revenue: number[] }[]) => rows.map((x) => [x.key, x.revenue]);

test('painel: receita por canal no primeiro e no último toque não direto', async () => {
  const r = await t.get<Res>('/analytics/attribution?days=7');
  expect(r).toMatchObject({ conversions: 2, revenue: 400, windowDays: 30 });
  expect(keys(r.first.channel)).toEqual([
    ['social', [300]],
    ['organic', [100]],
  ]);
  expect(keys(r.last.channel)).toEqual([
    ['email', [300]],
    ['organic', [100]],
  ]);
  expect(keys(r.last.campaign)).toEqual([
    ['outubro', [300]],
    ['(sem campanha)', [100]],
  ]);
  expect(keys(r.first.source)).toEqual([
    ['instagram', [300]],
    ['google.com', [100]],
  ]);
  expect(r.events.map((e) => e.key)).toEqual(['compra', 'cadastro']);
  const signup = await t.get<Res>('/analytics/attribution?days=7&event=cadastro');
  expect(signup.conversions).toBe(1);
  expect(signup.last.channel[0]!.key).toBe('organic');
});

test('experimento: por variação, meta primária por padrão', async () => {
  const r = await t.get<Res>('/experiments/exp_attr/attribution?days=7');
  expect(r.variations!.map((v) => v.id)).toEqual(['a0', 'a1']);
  expect(r.first.channel.map((x) => [x.key, x.conversions])).toEqual([
    ['social', [0, 1]],
    ['organic', [1, 0]],
  ]);
  expect(r.last.channel[0]).toMatchObject({ key: 'email', revenue: [0, 300] });
});

test('isolamento por conta e 404', async () => {
  const other = await t.req('/analytics/attribution?days=7', { as: 'other' });
  expect(((await other.json()) as Res).conversions).toBe(0);
  expect((await t.req('/experiments/exp_attr/attribution', { as: 'other' })).status).toBe(404);
  expect((await t.req('/experiments/exp_attr/attribution', { as: 'viewer' })).status).toBe(200);
});
