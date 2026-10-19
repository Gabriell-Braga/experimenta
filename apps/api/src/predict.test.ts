import { propensity, type TrackingEvent } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import { auc, samples, trainPropensity } from './predict';
import { DEMO } from './seed';
import { ev, setupApp } from './test-app';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 19);

/** Visitantes que veem mais páginas compram mais; celular compra menos. */
function world(n = 600, now = NOW): TrackingEvent[] {
  const out: TrackingEvent[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const v = `v${i}`;
    const device = i % 3 === 0 ? 'mobile' : 'desktop';
    const pages = 1 + Math.floor(rnd() * 8);
    const t0 = now - 30 * DAY + Math.floor(rnd() * 15) * DAY;
    for (let k = 0; k < pages; k++)
      out.push({
        type: 'pageview',
        visitorId: v,
        sessionId: `s${i}`,
        ts: t0 + k * 1000,
        url: `http://x.com/p${k}`,
        device,
        eventId: `${v}-${k}`,
      } as TrackingEvent);
    const p = (pages / 8) * (device === 'mobile' ? 0.3 : 0.8);
    if (rnd() < p)
      out.push({
        type: 'event',
        visitorId: v,
        sessionId: `s${i}`,
        ts: t0 + pages * 1000 + 5000,
        url: 'http://x.com/ok',
        name: 'compra',
        eventId: `${v}-c`,
      } as TrackingEvent);
  }
  return out;
}

test('AUC: perfeito = 1, invertido = 0, empates = 0,5', () => {
  expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
  expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
  expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
});

test('exemplos: rótulo só dentro do horizonte e só depois da página; recentes demais ficam de fora', () => {
  const e = [
    {
      type: 'pageview',
      visitorId: 'a',
      sessionId: 's',
      ts: NOW - 10 * DAY,
      url: 'http://x.com/',
      device: 'desktop',
    },
    {
      type: 'event',
      visitorId: 'a',
      sessionId: 's',
      ts: NOW - 9 * DAY,
      url: 'http://x.com/',
      name: 'compra',
    },
    {
      type: 'pageview',
      visitorId: 'b',
      sessionId: 's2',
      ts: NOW - 10 * DAY,
      url: 'http://x.com/',
      device: 'mobile',
    },
    {
      type: 'event',
      visitorId: 'b',
      sessionId: 's2',
      ts: NOW - 1 * DAY,
      url: 'http://x.com/',
      name: 'compra',
    },
    {
      type: 'pageview',
      visitorId: 'c',
      sessionId: 's3',
      ts: NOW - DAY,
      url: 'http://x.com/',
      device: 'desktop',
    },
  ] as TrackingEvent[];
  const s = samples(e, 'compra', 7, NOW);
  expect(s.map((x) => [x.visitor, x.y]).sort()).toEqual([
    ['a', 1],
    ['b', 0],
  ]);
});

test('modelo aprende: AUC alto, páginas pesam a favor, celular contra; score do navegador = score do treino', () => {
  const r = trainPropensity(world(), { goal: 'compra', horizonDays: 7, enabled: true }, NOW);
  if ('error' in r) throw new Error(r.error);
  expect(r.auc).toBeGreaterThan(0.7);
  const w = Object.fromEntries(r.importance.map((x) => [x.feature, x.weight]));
  expect(w['Páginas vistas']).toBeGreaterThan(0);
  expect(w['Celular']).toBeLessThan(0);
  // Decil do topo converte mais que o de baixo.
  expect(r.deciles[0]!.rate).toBeGreaterThan(r.deciles[9]!.rate);
  const hi = propensity(
    r,
    { pv: 8, s: 1, ev: {}, f: NOW, p: ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'] },
    'desktop',
    NOW,
  );
  const lo = propensity(r, { pv: 1, s: 1, ev: {}, f: NOW, p: ['/a'] }, 'mobile', NOW);
  expect(hi).toBeGreaterThan(lo);
});

test('poucos positivos: recusa treinar', () => {
  const r = trainPropensity(world(30), { goal: 'compra', horizonDays: 7, enabled: true }, NOW);
  expect(r).toMatchObject({ error: expect.stringContaining('poucos exemplos') });
});

let t: Awaited<ReturnType<typeof setupApp>>;
const files = new Map<string, string>();
beforeAll(async () => {
  t = await setupApp({
    cdn: {
      get: async (n) => files.get(n) ?? (n === 'abt.js' ? '/*rt*/' : null),
      put: async (n, b) => void files.set(n, b),
    },
  });
});

test('rota: sem configuração 400; treina, publica o modelo na config; viewer não treina', async () => {
  const train = (as = 'editor') => t.req('/predictive/train', { method: 'POST', as });
  expect((await train()).status).toBe(400);
  await t.repo.insertEvents(
    DEMO.accountId,
    world(600, Date.now()).map((e) => ev(e as never)),
  );
  const cfg = await t.req('/entities/propensity', {
    method: 'POST',
    as: 'editor',
    body: JSON.stringify({ name: 'compra', data: { goal: 'compra' } }),
  });
  expect(cfg.status).toBe(201);
  expect((await train('viewer')).status).toBe(403);
  const r = await train();
  expect(r.status).toBe(200);
  const g = await t.get<{ model: { auc: number } }>('/predictive');
  expect(g.model.auc).toBeGreaterThan(0.6);
  const published = JSON.parse(files.get(`${DEMO.accountId}.json`)!) as {
    propensity: { goal: string; w: number[] };
  };
  expect(published.propensity.goal).toBe('compra');
  expect(published.propensity.w).toHaveLength(11);
});
