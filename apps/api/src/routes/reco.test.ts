import { beforeAll, expect, test } from 'vitest';
import { buildRecoModel } from '../reco';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const view = (visitorId: string, id: string, extra: object = {}) =>
  ev({
    type: 'event',
    visitorId,
    name: 'product_view',
    props: {
      id,
      name: `P${id}`,
      price: Number(id) * 100,
      category: Number(id) < 4 ? 'corrida' : 'acessorios',
      ...extra,
    },
  } as never);
const buy = (visitorId: string, ids: string) =>
  ev({ type: 'event', visitorId, name: 'purchase', value: 1, props: { ids } } as never);

beforeAll(async () => {
  t = await setupApp();
  await t.collect([
    view('a', '1'),
    view('a', '2'),
    view('a', '4'),
    view('b', '1'),
    view('b', '2'),
    view('c', '1'),
    view('c', '3'),
    view('d', '5'),
    buy('a', '1,4'),
    buy('b', '1,4'),
    buy('c', '3'),
  ]);
});

test('modelo: catálogo, co-visualização, comprados juntos, mais vendidos e categoria', async () => {
  const r = await t.req('/recommendations/rebuild', { as: 'editor', method: 'POST' });
  expect(await r.json()).toMatchObject({ products: 5 });
  const coview = (await (await t.app.request('/reco/demo/coview?product=1&limit=2')).json()) as {
    items: { id: string; name: string }[];
  };
  expect(coview.items.map((i) => i.id)).toEqual(['2', '4']); // 2 visto junto 2×, 4 e 3 1× (4 vem antes por popularidade)
  const co = (await (await t.app.request('/reco/demo/copurchase?product=1&limit=1')).json()) as {
    items: { id: string }[];
  };
  expect(co.items[0]!.id).toBe('4');
  const up = (await (await t.app.request('/reco/demo/upsell?product=1&limit=3')).json()) as {
    items: { id: string; price: number }[];
  };
  expect(up.items.slice(0, 2).every((i) => i.price > 100)).toBe(true);
  expect((await t.app.request('/reco/demo/xyz')).status).toBe(400);
  expect((await t.app.request('/reco/nao-existe/coview')).status).toBe(404);
  expect((await t.req('/recommendations/rebuild', { as: 'viewer', method: 'POST' })).status).toBe(403);
});

test('grupos enormes (robô) não contam na associação', () => {
  const bot = Array.from({ length: 80 }, (_, i) => view('bot', String(i)));
  const m = buildRecoModel(bot as never);
  expect(m.coview['1']).toBeUndefined();
});
