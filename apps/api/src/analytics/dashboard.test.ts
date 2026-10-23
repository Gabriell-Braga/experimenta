import { ExperimentSchema, type TrackingEvent } from '@abtest/shared';
import { expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';
import { testRepo } from '../test-repo';
import { dailyStatsJob, dayStats, ensureDays, type DayStats } from './daily';
import { dashboardSummary, experimentSummary } from './dashboard';
import { dayOf, daysBetween } from './overview';
import { experimentReport } from './report';

const DAY = 86_400_000;
const to = new Date(Date.UTC(2026, 9, 19, 12));
const at = (d: number) => to.getTime() - d * DAY;
let n = 0;
const pv = (v: string, d: number, url = 'http://x.com/') =>
  ({
    eventId: `e${++n}`,
    type: 'pageview',
    visitorId: v,
    sessionId: `s${v}${d}`,
    ts: at(d),
    url,
    device: 'desktop',
  }) as TrackingEvent;

const exp = ExperimentSchema.parse({
  id: 'e1',
  key: 'hero',
  name: 'Hero',
  status: 'running',
  variations: [
    { id: 'a', key: 'a', name: 'Controle', weight: 50 },
    { id: 'b', key: 'b', name: 'B', weight: 50 },
  ],
  goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
});

/** Agregados por dia de uma lista de eventos (o que o job grava). */
function byDay(events: TrackingEvent[]) {
  const days = new Map<string, TrackingEvent[]>();
  for (const e of events) days.set(dayOf(e.ts), [...(days.get(dayOf(e.ts)) ?? []), e]);
  return new Map<string, DayStats>([...days].map(([d, list]) => [d, dayStats(list, d)]));
}

test('resumo do painel pelos agregados diários: tráfego vs período anterior, frustração, scroll e formulários', () => {
  const events: TrackingEvent[] = [];
  for (let i = 0; i < 200; i++) events.push(pv(`v${i}`, 1), pv(`v${i}`, 2)); // mesmos 200 em 2 dias
  for (let i = 0; i < 100; i++) events.push(pv(`p${i}`, 9));
  events.push(
    {
      ...pv('v1', 1, 'http://x.com/carrinho'),
      type: 'frustration',
      kind: 'rage',
    } as unknown as TrackingEvent,
    { ...pv('v1', 1), type: 'scroll', depth: 40 } as unknown as TrackingEvent,
    { ...pv('v2', 2), type: 'scroll', depth: 80 } as unknown as TrackingEvent,
    ...[true, false].map(
      (submitted) =>
        ({
          ...pv('v1', 1),
          type: 'form',
          form: 'f',
          variations: {},
          interacted: true,
          submitted,
          fields: [],
        }) as unknown as TrackingEvent,
    ),
  );
  const days = daysBetween(new Date(at(7)), to);
  const prevDays = daysBetween(new Date(at(15)), new Date(at(8)));
  const stats = byDay(events);
  for (const d of [...days, ...prevDays]) if (!stats.has(d)) stats.set(d, dayStats([], d));
  const s = dashboardSummary({
    days,
    prevDays,
    stats,
    unique: { cur: { visitors: 200, sessions: 400 }, prev: { visitors: 100, sessions: 100 } },
    to,
  });
  expect(s.pendingDays).toBe(0);
  expect(s.traffic).toMatchObject({ visitors: 200, pageviews: 400 });
  expect(s.traffic.deltas.visitors).toBe(1); // +100%
  expect(s.traffic.deltas.pageviews).toBe(3);
  expect(s.traffic.series.find((x) => x.day === dayOf(at(1)))!.visitors).toBe(200);
  expect(s.behavior).toMatchObject({ rage: 1, worstPage: 'http://x.com/carrinho', avgScroll: 60 });
  expect(s.forms).toMatchObject({ interacted: 2, submitted: 1, completion: 0.5 });

  // Dia do período anterior sem agregado: sem variação (seria +∞ enganoso); dia do período conta como pendente.
  stats.delete(prevDays[0]!);
  stats.delete(days[0]!);
  const partial = dashboardSummary({
    days,
    prevDays,
    stats,
    unique: { cur: { visitors: 1, sessions: 1 }, prev: { visitors: 1, sessions: 1 } },
    to,
  });
  expect(partial.pendingDays).toBe(1);
  expect(partial.traffic.deltas.pageviews).toBeNull();
});

test('resumo do teste: líder e duração restante classificada (acima de 8 semanas não promete fim)', () => {
  const cur: TrackingEvent[] = [];
  for (let i = 0; i < 200; i++) {
    const arm = i % 2 ? 'b' : 'a';
    const base = {
      visitorId: `v${i}`,
      url: '',
      experimentId: 'e1',
      experimentKey: 'hero',
      variationId: arm,
      variationKey: arm,
    };
    cur.push({ ...base, type: 'exposure', ts: at(1) } as TrackingEvent);
    if (arm === 'b' ? i % 10 < 6 : i % 10 < 2)
      cur.push({
        ...base,
        type: 'conversion',
        ts: at(1) + 1,
        goalId: 'g',
        goalKey: 'compra',
      } as TrackingEvent);
  }
  const r = experimentReport(exp, cur, { from: new Date(at(7)), to });
  expect(experimentSummary(exp, r)).toMatchObject({
    name: 'Hero',
    visitors: 200,
    srm: false,
    leader: { name: 'B' },
  });
  const slow = { ...r, estimate: { ...r.estimate, daysRemaining: 10658 } };
  expect(experimentSummary(exp, slow).duration).toEqual({ kind: 'too-long' });
});

test('agregados no banco: grava só dias fechados, relê sem tocar no cru, limite por requisição e job', async () => {
  const repo = await testRepo();
  const { id } = await repo.createAccount('Painel');
  const now = Date.UTC(2026, 9, 19, 12);
  const day = (k: number) => dayOf(now - k * DAY);
  const ev = (v: string, k: number, extra: object = {}) =>
    ({ ...pv(v, 0), accountId: id, ts: now - k * DAY, ...extra }) as TrackingEvent;
  await repo.insertEvents(id, [ev('a', 0), ev('a', 1), ev('b', 1), ev('c', 3), ev('q', 1, { qa: true })]);

  const days = [day(3), day(2), day(1), day(0)];
  const first = await ensureDays(repo, id, days, 2, now);
  // Só os 2 mais recentes calculados; hoje não é gravado (dia aberto).
  expect(first.missing).toEqual([day(3), day(2)]);
  expect(first.stats.get(day(1))!.pageviews).toBe(2);
  expect((await repo.listDailyStats(id, day(3), day(0))).map((r) => r.day)).toEqual([day(1)]);

  // Evento atrasado de ontem não muda a linha gravada; o de hoje entra (cru).
  await repo.insertEvents(id, [ev('d', 1), ev('d', 0)]);
  const again = await ensureDays(repo, id, days, 2, now);
  expect(again.stats.get(day(1))!.pageviews).toBe(2);
  expect(again.stats.get(day(0))!.pageviews).toBe(2);

  await dailyStatsJob(repo, now);
  const saved = await repo.listDailyStats<DayStats>(id, day(3), day(0));
  expect(saved.find((r) => r.day === day(3))!.data.pageviews).toBe(1);

  // Únicos do período contados no banco, sem QA.
  expect(
    await repo.countDistinct(id, { from: new Date(now - 4 * DAY), to: new Date(now), types: ['pageview'] }),
  ).toEqual({
    visitors: 4,
    sessions: 4,
  });
});

test('rotas do painel: cada bloco à parte e o painel inteiro', async () => {
  const t = await setupApp();
  await t.collect([
    ev({ type: 'pageview', visitorId: 'r1', device: 'desktop' } as never),
    ev({ type: 'identify', visitorId: 'r1', userId: 'u1' } as never),
    ev({ type: 'pageview', visitorId: 'r2', device: 'mobile' } as never),
  ]);
  const s = await t.get<{ traffic: { visitors: number; pageviews: number }; pendingDays: number }>(
    '/analytics/dashboard/summary?days=7',
  );
  expect(s.traffic).toMatchObject({ visitors: 2, pageviews: 2 });
  expect(s.pendingDays).toBe(0);
  expect(await t.get('/analytics/dashboard/experiments?days=7')).toEqual({ experiments: [] });
  expect(await t.get('/analytics/dashboard/insights?days=30')).toMatchObject({ insights: [] });
  expect(await t.get('/analytics/dashboard/profiles?days=7')).toEqual({
    profiles: { identified: 1, multiDevice: 0 },
  });
  const all = await t.get<Record<string, unknown>>('/analytics/dashboard?days=7');
  expect(Object.keys(all)).toEqual(
    expect.arrayContaining(['traffic', 'experiments', 'insights', 'profiles']),
  );
  expect((await t.req('/analytics/dashboard/nada', { as: 'owner' })).status).toBe(400);
});
