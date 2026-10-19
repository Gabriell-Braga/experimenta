import { ExperimentSchema, type TrackingEvent } from '@abtest/shared';
import { expect, test } from 'vitest';
import { dashboard } from './dashboard';

const DAY = 86_400_000;
const to = new Date(Date.UTC(2026, 9, 19));
const range = { from: new Date(to.getTime() - 7 * DAY), to };
const at = (d: number) => to.getTime() - d * DAY;
const pv = (v: string, d: number) =>
  ({
    type: 'pageview',
    visitorId: v,
    sessionId: `s${v}${d}`,
    ts: at(d),
    url: 'http://x.com/',
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

test('painel: tráfego com variação vs período anterior, líder do experimento, frustração e formulários', () => {
  const cur: TrackingEvent[] = [];
  for (let i = 0; i < 200; i++) {
    const v = `v${i}`;
    const arm = i % 2 ? 'b' : 'a';
    cur.push(pv(v, 1));
    cur.push({
      type: 'exposure',
      visitorId: v,
      ts: at(1) + 1,
      url: '',
      experimentId: 'e1',
      experimentKey: 'hero',
      variationId: arm,
      variationKey: arm,
    } as TrackingEvent);
    // B converte 3x mais.
    if (arm === 'b' ? i % 10 < 6 : i % 10 < 2)
      cur.push({
        type: 'conversion',
        visitorId: v,
        ts: at(1) + 2,
        url: '',
        experimentId: 'e1',
        experimentKey: 'hero',
        variationId: arm,
        variationKey: arm,
        goalId: 'g',
        goalKey: 'compra',
      } as TrackingEvent);
  }
  cur.push({
    type: 'frustration',
    kind: 'rage',
    visitorId: 'v1',
    ts: at(1),
    url: 'http://x.com/carrinho',
  } as TrackingEvent);
  cur.push({
    type: 'form',
    visitorId: 'v1',
    ts: at(1),
    url: 'http://x.com/',
    form: 'f',
    variations: {},
    device: 'desktop',
    interacted: true,
    submitted: false,
    fields: [],
  } as unknown as TrackingEvent);
  cur.push({
    type: 'form',
    visitorId: 'v2',
    ts: at(1),
    url: 'http://x.com/',
    form: 'f',
    variations: {},
    device: 'desktop',
    interacted: true,
    submitted: true,
    fields: [],
  } as unknown as TrackingEvent);
  const prev = Array.from({ length: 100 }, (_, i) => pv(`p${i}`, 9));

  const d = dashboard(cur, prev, range, [exp]);
  expect(d.traffic.visitors).toBe(200);
  expect(d.traffic.deltas.visitors).toBe(1); // +100%
  expect(d.experiments).toHaveLength(1);
  expect(d.experiments[0]).toMatchObject({ name: 'Hero', visitors: 200, srm: false, leader: { name: 'B' } });
  expect(d.experiments[0]!.leader!.probBeatControl).toBeGreaterThan(0.99);
  expect(d.behavior).toMatchObject({ rage: 1, worstPage: 'http://x.com/carrinho' });
  expect(d.forms).toMatchObject({ interacted: 2, submitted: 1, completion: 0.5 });
});
