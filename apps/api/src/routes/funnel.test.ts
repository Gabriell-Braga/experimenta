import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
let funnelId: string;
const S = 'http://localhost:5180';
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setupApp();
  const now = Date.now() - 3 * DAY;
  const pv = (v: string, path: string, at: number, device = 'desktop') =>
    ev({ type: 'pageview', visitorId: v, url: S + path, ts: now + at, device } as never);
  await t.collect([
    // a: completa (home → produto → compra) em 2 min.
    pv('a', '/', 0),
    pv('a', '/produto.html', 60_000),
    ev({ type: 'event', visitorId: 'a', name: 'compra', ts: now + 120_000 } as never),
    // b: home → produto e sai para /loja.
    pv('b', '/', 0),
    pv('b', '/produto.html', 30_000),
    pv('b', '/loja/', 40_000),
    // c: só home (celular) e sai do site.
    pv('c', '/', 0, 'mobile'),
    // d: produto ANTES da home não conta (ordem), depois home e nada.
    pv('d', '/produto.html', 0),
    pv('d', '/', 1000),
    // e: compra fora da janela de 1 dia.
    pv('e', '/', 0),
    pv('e', '/produto.html', 1000),
    ev({ type: 'event', visitorId: 'e', name: 'compra', ts: now + 2 * DAY } as never),
  ]);
  const r = await t.req('/entities/funnel', {
    as: 'editor',
    method: 'POST',
    body: JSON.stringify({
      name: 'Compra',
      data: {
        windowDays: 1,
        steps: [
          { type: 'url', name: 'Home', url: { match: 'exact', value: `${S}/` } },
          { type: 'url', name: 'Produto', url: { match: 'contains', value: '/produto' } },
          { type: 'event', name: 'Compra', event: 'compra' },
        ],
      },
    }),
  });
  expect(r.status).toBe(201);
  funnelId = ((await r.json()) as { id: string }).id;
});

type Rep = {
  visitors: number;
  completed: number;
  conversion: number;
  steps: {
    name: string;
    visitors: number;
    fromPrevious: number;
    dropoff: number;
    medianMsFromPrevious: number | null;
    dropoffNext: { page: string; count: number }[];
  }[];
};

test('funil em ordem, com janela; conversão, tempo e para onde vão os que desistem', async () => {
  const r = await t.get<Rep>(`/analytics/funnel/${funnelId}?days=7`);
  expect(r.steps.map((s) => s.visitors)).toEqual([5, 3, 1]);
  expect(r.completed).toBe(1);
  expect(r.conversion).toBeCloseTo(0.2, 6);
  expect(r.steps[1]!.fromPrevious).toBeCloseTo(0.6, 6);
  expect(r.steps[1]!.medianMsFromPrevious).toBe(30_000);
  expect(r.steps[0]!.dropoff).toBe(2);
  expect(r.steps[0]!.dropoffNext).toEqual([{ page: '(saiu do site)', count: 2 }]);
  expect(r.steps[1]!.dropoffNext).toEqual([
    { page: '/loja', count: 1 },
    { page: '(saiu do site)', count: 1 },
  ]);
});

test('filtro de dispositivo, CRUD e validação das entidades', async () => {
  expect((await t.get<Rep>(`/analytics/funnel/${funnelId}?device=mobile`)).visitors).toBe(1);
  const list = await t.get<{ id: string; name: string }[]>('/entities/funnel');
  expect(list.map((f) => f.name)).toEqual(['Compra']);
  expect(await t.get('/entities/funnel', 'other')).toEqual([]);
  expect((await t.req(`/analytics/funnel/${funnelId}`, { as: 'other' })).status).toBe(404);
  // Um passo só é inválido; viewer não grava.
  const bad = await t.req('/entities/funnel', {
    as: 'editor',
    method: 'POST',
    body: JSON.stringify({ name: 'x', data: { steps: [] } }),
  });
  expect(bad.status).toBe(400);
  expect(
    (
      await t.req('/entities/funnel', {
        as: 'viewer',
        method: 'POST',
        body: JSON.stringify({ name: 'x', data: {} }),
      })
    ).status,
  ).toBe(403);
  expect((await t.req('/entities/xyz', { as: 'owner' })).status).toBe(400);
  const put = await t.req(`/entities/funnel/${funnelId}`, {
    as: 'editor',
    method: 'PUT',
    body: JSON.stringify({
      name: 'Compra 2',
      data: {
        steps: [
          { type: 'event', name: 'a', event: 'a' },
          { type: 'event', name: 'b', event: 'b' },
        ],
      },
    }),
  });
  expect(put.status).toBe(200);
  expect(
    (await t.get<{ name: string; data: { windowDays: number } }>(`/entities/funnel/${funnelId}`)).data
      .windowDays,
  ).toBe(7);
  expect((await t.req(`/entities/funnel/${funnelId}`, { as: 'other', method: 'DELETE' })).status).toBe(404);
  expect((await t.req(`/entities/funnel/${funnelId}`, { as: 'editor', method: 'DELETE' })).status).toBe(204);
  expect(await t.get('/entities/funnel')).toEqual([]);
});
