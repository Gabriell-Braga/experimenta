import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const PAGE = 'http://localhost:5180/loja/';

beforeAll(async () => {
  t = await setupApp();
  const ctx = (device: string, variations: Record<string, string> = {}) => ({
    url: PAGE,
    device,
    variations,
  });
  await t.collect([
    ev({
      type: 'click',
      ...ctx('desktop'),
      selector: '#buy',
      rx: 0.5,
      ry: 0.5,
      px: 1,
      py: 1,
      vw: 1,
      vh: 1,
    } as never),
    ev({
      type: 'frustration',
      ...ctx('desktop', { e1: 'b' }),
      kind: 'rage',
      selector: '#buy',
      rx: 0.2,
      ry: 0.3,
      count: 3,
    } as never),
    ev({
      type: 'frustration',
      ...ctx('mobile'),
      kind: 'dead',
      selector: '#buy',
      rx: 0.1,
      ry: 0.1,
      count: 1,
    } as never),
    ev({
      type: 'frustration',
      ...ctx('desktop'),
      kind: 'dead',
      selector: '.img',
      rx: 0.1,
      ry: 0.1,
      count: 1,
    } as never),
    ev({
      type: 'move',
      ...ctx('desktop'),
      points: [
        [0.1, 10],
        [0.2, 20],
      ],
      vw: 1200,
    } as never),
    ev({ type: 'move', ...ctx('mobile'), points: [[0.5, 50]], vw: 390, url: `${PAGE}?utm=x` } as never),
    ev({
      type: 'move',
      ...ctx('desktop'),
      points: [[0.9, 90]],
      vw: 1200,
      url: 'http://localhost:5180/outra',
    } as never),
  ]);
});

type Heat = {
  clicks: { total: number };
  moves: [number, number][];
  frustration: { selector: string; rage: number; dead: number; points: [number, number][] }[];
};

test('mapa de calor traz movimento (página normalizada) e frustração por elemento', async () => {
  const h = await t.get<Heat>(`/heatmap?url=${encodeURIComponent(PAGE)}`);
  expect(h.clicks.total).toBe(1);
  expect(h.moves).toHaveLength(3);
  expect(h.frustration).toEqual([
    { selector: '#buy', rage: 1, dead: 1, points: expect.any(Array) },
    { selector: '.img', rage: 0, dead: 1, points: [[0.1, 0.1]] },
  ]);
});

test('filtros de dispositivo e variação valem para movimento e frustração', async () => {
  const mobile = await t.get<Heat>(`/heatmap?url=${encodeURIComponent(PAGE)}&device=mobile`);
  expect(mobile.moves).toEqual([[0.5, 50]]);
  expect(mobile.frustration.map((f) => [f.selector, f.dead])).toEqual([['#buy', 1]]);
  const varB = await t.get<Heat>(`/heatmap?url=${encodeURIComponent(PAGE)}&experimentId=e1&variationId=b`);
  expect(varB.frustration).toEqual([{ selector: '#buy', rage: 1, dead: 0, points: [[0.2, 0.3]] }]);
  expect(varB.moves).toEqual([]);
});

test('páginas: vistas, visitantes, cliques, frustração e scroll médio, mais vistas primeiro', async () => {
  await t.collect([
    ev({ type: 'pageview', url: PAGE, device: 'desktop', title: 'Loja', visitorId: 'a' } as never),
    ev({ type: 'pageview', url: `${PAGE}?x=1`, device: 'mobile', visitorId: 'b' } as never),
    ev({ type: 'pageview', url: 'http://localhost:5180/', device: 'desktop', visitorId: 'a' } as never),
    ev({ type: 'scroll', url: PAGE, device: 'desktop', variations: {}, depth: 80, vh: 1, ph: 1 } as never),
    ev({ type: 'scroll', url: PAGE, device: 'desktop', variations: {}, depth: 40, vh: 1, ph: 1 } as never),
  ]);
  const pages =
    await t.get<
      {
        page: string;
        title: string;
        pageviews: number;
        visitors: number;
        clicks: number;
        rage: number;
        dead: number;
        avgScroll: number | null;
      }[]
    >('/analytics/pages?days=7');
  expect(pages[0]).toEqual({
    page: 'http://localhost:5180/loja',
    href: 'http://localhost:5180/loja/',
    title: 'Loja',
    pageviews: 2,
    visitors: 2,
    clicks: 1,
    rage: 1,
    dead: 2,
    avgScroll: 60,
  });
  const mobile = await t.get<{ page: string; pageviews: number }[]>('/analytics/pages?device=mobile');
  expect(mobile.find((p) => p.page.endsWith('/loja'))!.pageviews).toBe(1);
});
