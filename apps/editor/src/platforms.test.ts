import { expect, test, vi } from 'vitest';
import { shopifyPixel, shopifyTheme } from './platforms';

test('pixel do Shopify: compra vira evento purchase e conversão das metas purchase das variações do visitante', async () => {
  let handler: ((e: unknown) => Promise<void>) | undefined;
  const sent: { url: string; body: string }[] = [];
  const config = {
    accountId: 'acc',
    trackingUrl: 'https://api.test/collect',
    experiments: [
      {
        id: 'x1',
        key: 'hero',
        variations: [
          { id: 'a', key: 'controle' },
          { id: 'b', key: 'nova' },
        ],
        goals: [
          { id: 'g1', key: 'compra', type: 'custom', event: 'purchase' },
          { id: 'g2', key: 'clique', type: 'click', selector: 'a' },
        ],
      },
      {
        id: 'x2',
        key: 'outro',
        variations: [{ id: 'c', key: 'c' }],
        goals: [{ id: 'g3', key: 'compra', type: 'custom', event: 'purchase' }],
      },
    ],
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') sent.push({ url, body: init.body as string });
    return { json: async () => config };
  });
  const run = new Function('analytics', 'browser', 'fetch', shopifyPixel('https://api.test', 'acc'));
  run(
    { subscribe: (name: string, fn: typeof handler) => name === 'checkout_completed' && (handler = fn) },
    {
      cookie: { get: async (k: string) => (k === '_abt_vid' ? 'v1' : '') },
      localStorage: { getItem: async (k: string) => (k === '_abt_a' ? '{"x1":"b"}' : null) },
    },
    fetch,
  );
  await handler!({
    id: 'evt',
    context: { document: { location: { href: 'https://loja.test/checkouts/1/thank-you' } } },
    data: {
      checkout: {
        totalPrice: { amount: '149.90' },
        currencyCode: 'BRL',
        order: { id: 'gid://shopify/Order/9' },
      },
    },
  });
  expect(fetch).toHaveBeenCalledWith('https://api.test/cdn/acc.json');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toBe('https://api.test/collect');
  const { events } = JSON.parse(sent[0]!.body) as { events: Record<string, unknown>[] };
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    type: 'event',
    name: 'purchase',
    value: 149.9,
    visitorId: 'v1',
    accountId: 'acc',
    eventId: 'shopify-acc-gid://shopify/Order/9',
    props: { order: 'gid://shopify/Order/9', currency: 'BRL' },
  });
  expect(events[1]).toMatchObject({
    type: 'conversion',
    experimentKey: 'hero',
    variationId: 'b',
    variationKey: 'nova',
    goalKey: 'compra',
    value: 149.9,
  });
});

test('tema do Shopify: snippet primeiro e identify com e-mail escapado pelo Liquid', () => {
  const t = shopifyTheme('https://api.test', 'acc');
  expect(t.startsWith('<script src="https://api.test/cdn/acc.js"></script>')).toBe(true);
  expect(t).toContain('{{ customer.email | json }}');
});
