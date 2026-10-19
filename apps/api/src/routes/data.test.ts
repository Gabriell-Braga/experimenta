import { beforeAll, expect, test } from 'vitest';
import { daysBetween } from '../analytics/overview';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setupApp();
  const now = Date.now();
  const pv = (visitorId: string, sessionId: string, url: string, ts = now, device = 'desktop') =>
    ev({ type: 'pageview', visitorId, sessionId, url, ts, device } as never);
  const r = await t.collect([
    pv('v1', 's1', 'http://localhost:5180/', now - 2 * DAY),
    pv('v1', 's1', 'http://localhost:5180/produto?x=1', now - 2 * DAY + 1000),
    pv('v2', 's2', 'http://localhost:5180/', now, 'mobile'),
    ev({
      type: 'pageview',
      visitorId: 'v3',
      sessionId: 's3',
      device: 'desktop',
      referrer: 'https://www.google.com/search',
    } as never),
    ev({ type: 'event', visitorId: 'v1', sessionId: 's1', name: 'compra', value: 100 } as never),
    ev({ type: 'event', visitorId: 'v2', sessionId: 's2', name: 'compra', value: 50.5 } as never),
    ev({
      type: 'identify',
      visitorId: 'v2',
      sessionId: 's2',
      userId: 'u-1',
      attrs: { plano: 'pro' },
    } as never),
    // QA não entra nos números.
    ev({ type: 'pageview', visitorId: 'qa', sessionId: 'sqa', device: 'desktop', qa: true } as never),
  ]);
  expect(r.status).toBe(204);
});

test('visão geral: totais, série diária sem buracos, páginas, eventos, dispositivos e referências', async () => {
  const o = await t.get<{
    totals: Record<string, number>;
    series: { day: string; pageviews: number; visitors: number }[];
    topPages: { key: string; count: number }[];
    topEvents: { key: string; count: number }[];
    devices: Record<string, number>;
    referrers: { key: string; count: number }[];
  }>('/analytics/overview?days=7');
  expect(o.totals).toMatchObject({ visitors: 3, sessions: 3, pageviews: 4, events: 2, revenue: 150.5 });
  expect(o.series.length).toBeGreaterThanOrEqual(7);
  expect(o.series.reduce((s, d) => s + d.pageviews, 0)).toBe(4);
  expect(o.topPages[0]).toEqual({ key: 'http://localhost:5180', count: 3 });
  expect(o.topEvents).toEqual([{ key: 'compra', count: 2 }]);
  expect(o.devices).toEqual({ desktop: 3, mobile: 1 });
  expect(o.referrers).toEqual([{ key: 'www.google.com', count: 1 }]);
});

test('eventos recentes: filtro por tipo e por visitante, mais recente primeiro; isolado por conta', async () => {
  const list = await t.get<{ type: string; visitorId: string; ts: number }[]>('/events?visitorId=v1');
  expect(list.map((e) => e.type)).toEqual(['event', 'pageview', 'pageview']);
  const ids = await t.get<{ type: string }[]>('/events?type=identify');
  expect(ids).toHaveLength(1);
  expect(await t.get<unknown[]>('/events', 'other')).toEqual([]);
  expect((await t.req('/events')).status).toBe(401);
});

test('listEvents filtra por sessão e período', async () => {
  const s1 = await t.repo.listEvents('demo', { sessionId: 's1' });
  expect(s1.map((e) => e.type)).toEqual(['pageview', 'pageview', 'event']);
  const recent = await t.repo.listEvents('demo', { from: new Date(Date.now() - DAY), types: ['pageview'] });
  expect(recent.map((e) => e.visitorId).sort()).toEqual(['qa', 'v2', 'v3']);
});

test('daysBetween inclui os dois extremos', () => {
  expect(daysBetween(new Date('2026-01-30T10:00:00Z'), new Date('2026-02-02T01:00:00Z'))).toEqual([
    '2026-01-30',
    '2026-01-31',
    '2026-02-01',
    '2026-02-02',
  ]);
});
