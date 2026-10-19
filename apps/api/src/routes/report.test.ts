import { ExperimentSchema, type TrackingEvent } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import type { ExperimentReport } from '../analytics/report';
import { DEMO } from '../seed';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const exp = ExperimentSchema.parse({
  id: 'exp_rep',
  key: 'rep',
  name: 'Relatório',
  status: 'running',
  variations: [
    { id: 'rv0', key: 'controle', name: 'Controle', weight: 50 },
    { id: 'rv1', key: 'b', name: 'B', weight: 50 },
  ],
  goals: [
    { id: 'g_buy', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'g_cta', key: 'cta', type: 'click', selector: '#cta' },
  ],
});

const exposure = (visitorId: string, variationId: string, ts: number) =>
  ev({
    type: 'exposure',
    visitorId,
    experimentId: exp.id,
    experimentKey: 'rep',
    variationId,
    variationKey: variationId === 'rv0' ? 'controle' : 'b',
    ts,
  } as never);
const conversion = (visitorId: string, variationId: string, goalId: string, ts: number, value?: number) =>
  ev({
    type: 'conversion',
    visitorId,
    experimentId: exp.id,
    experimentKey: 'rep',
    variationId,
    variationKey: 'x',
    goalId,
    goalKey: goalId,
    ts,
    ...(value ? { value } : {}),
  } as never);

beforeAll(async () => {
  t = await setupApp();
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: exp,
  });
  const now = Date.now();
  const list: TrackingEvent[] = [];
  // 200 visitantes por braço; controle converte 10%, B 20% (compra, com receita).
  for (let i = 0; i < 400; i++) {
    const arm = i % 2 ? 'rv1' : 'rv0';
    const v = `rv-${i}`;
    list.push(exposure(v, arm, now - 3 * 86_400_000 + i));
    const k = Math.floor(i / 2);
    if ((arm === 'rv0' && k % 10 === 0) || (arm === 'rv1' && k % 5 === 0))
      list.push(conversion(v, arm, 'g_buy', now - 3 * 86_400_000 + i + 10, 100));
    // Mobile: os 40 primeiros de cada braço.
    list.push(
      ev({
        type: 'pageview',
        visitorId: v,
        device: k < 40 ? 'mobile' : 'desktop',
        ts: now - 3 * 86_400_000 + i,
      } as never),
    );
  }
  // Conversão repetida conta 1 visitante (receita soma); conversão antes da exposição e QA são ignoradas.
  list.push(conversion('rv-0', 'rv0', 'g_buy', now, 50));
  list.push(conversion('late', 'rv0', 'g_buy', now - 4 * 86_400_000));
  list.push(exposure('late', 'rv0', now - 3 * 86_400_000));
  list.push({ ...exposure('qa1', 'rv1', now), qa: true } as TrackingEvent);
  for (let i = 0; i < list.length; i += 150)
    expect((await t.collect(list.slice(i, i + 150))).status).toBe(204);
});

test('visitantes, conversões únicas, receita, taxa e estatística por variação', async () => {
  const r = await t.get<ExperimentReport>('/experiments/exp_rep/report?days=7');
  expect(r.visitors).toBe(401); // 400 + "late" (QA fora)
  expect(r.variations.map((v) => v.visitors)).toEqual([201, 200]);
  const buy = r.goals.find((g) => g.goalKey === 'compra')!;
  expect(buy.primary).toBe(true);
  expect(buy.hasRevenue).toBe(true);
  const [c, b] = buy.arms;
  expect(c).toMatchObject({ conversions: 20, revenue: 2050 }); // 20 visitantes, um com receita repetida
  expect(b).toMatchObject({ conversions: 40, revenue: 4000 });
  expect(b!.rate).toBeCloseTo(0.2, 6);
  expect(b!.probBeatControl!).toBeGreaterThan(0.99);
  expect(b!.verdict).toBe('winner');
  expect(c!.verdict).toBe('baseline');
  expect(buy.revenueArms![1]!.probBeatControl!).toBeGreaterThan(0.9);
  const cta = r.goals.find((g) => g.goalKey === 'cta')!;
  expect(cta.arms.map((a) => a.conversions)).toEqual([0, 0]);
  expect(cta.primary).toBe(false);
  expect(r.srm.mismatch).toBe(false);
  // Série acumulada termina no total.
  expect(r.series[1]!.points.at(-1)).toMatchObject({ visitors: 200 });
  expect(r.series[1]!.points.at(-1)!.rate).toBeCloseTo(0.2, 6);
  expect(r.estimate.neededPerVariation).toBeGreaterThan(1000);
});

test('filtro por dispositivo usa o dispositivo das páginas vistas', async () => {
  const r = await t.get<ExperimentReport>('/experiments/exp_rep/report?days=7&device=mobile');
  expect(r.variations.map((v) => v.visitors)).toEqual([40, 40]);
});

test('isolamento e 404', async () => {
  expect((await t.req('/experiments/exp_rep/report', { as: 'other' })).status).toBe(404);
  expect((await t.req('/experiments/nao-existe/report', { as: 'owner' })).status).toBe(404);
  expect((await t.req('/experiments/exp_rep/report', { as: 'viewer' })).status).toBe(200);
});
