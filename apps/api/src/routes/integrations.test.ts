import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { PublishedConfig } from '@abtest/shared';
import { compileAccountScript } from '../cdn';
import { hmacHex } from '../crypto';
import { DEMO } from '../seed';
import { ev, setupApp } from '../test-app';

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
afterEach(() => vi.unstubAllGlobals());

const post = (path: string, body: unknown, as = 'owner') =>
  t.req(path, { method: 'POST', body: JSON.stringify(body), as });

test('chave de API: só owner cria; autentica com o papel da chave; revogada para de funcionar', async () => {
  expect((await post('/account/api-keys', { name: 'x' }, 'editor')).status).toBe(403);
  const r = await post('/account/api-keys', { name: 'BI', role: 'viewer' });
  expect(r.status).toBe(201);
  const { id, key } = (await r.json()) as { id: string; key: string };
  expect(key.startsWith(`abk_${DEMO.accountId}.`)).toBe(true);

  const list = await t.get<{ prefix: string; role: string }[]>('/account/api-keys');
  expect(list).toHaveLength(1);
  expect(key.startsWith(list[0]!.prefix)).toBe(true);
  expect(JSON.stringify(list)).not.toContain(key);

  const auth = { authorization: `Bearer ${key}` };
  expect((await t.app.request('/experiments', { headers: auth })).status).toBe(200);
  // Papel viewer: não grava.
  const w = await t.app.request('/entities/funnel', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'f', data: { steps: [] } }),
  });
  expect(w.status).toBe(403);
  // Chave adulterada não passa.
  expect((await t.app.request('/experiments', { headers: { authorization: `Bearer ${key}x` } })).status).toBe(
    401,
  );

  expect((await t.req(`/account/api-keys/${id}`, { method: 'DELETE', as: 'owner' })).status).toBe(204);
  expect((await t.app.request('/experiments', { headers: auth })).status).toBe(401);
});

test('webhook: segredo gerado; eventos assinados só dos tipos assinados; teste e publicação', async () => {
  const calls: { url: string; body: string; sig: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: init.body as string,
      sig: new Headers(init.headers).get('x-abt-signature') ?? '',
    });
    return new Response(null, { status: 202 });
  });
  const r = await post(
    '/entities/webhook',
    { name: 'crm', data: { url: 'https://hook.test/in', events: ['conversion', 'publish'] } },
    'editor',
  );
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  const hook = await t.get<{ data: { secret: string } }>(`/entities/webhook/${id}`);
  expect(hook.data.secret).toMatch(/^whsec_/);

  await t.collect([
    ev({ type: 'pageview', device: 'desktop' } as never),
    ev({
      type: 'conversion',
      experimentId: 'e',
      experimentKey: 'hero',
      variationId: 'b',
      variationKey: 'b',
      goalId: 'g',
      goalKey: 'compra',
    } as never),
    ev({
      type: 'conversion',
      qa: true,
      experimentId: 'e',
      experimentKey: 'hero',
      variationId: 'b',
      variationKey: 'b',
      goalId: 'g',
      goalKey: 'compra',
    } as never),
  ]);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  const sent = JSON.parse(calls[0]!.body) as { type: string; events: { type: string }[] };
  expect(sent.type).toBe('events');
  expect(sent.events.map((e) => e.type)).toEqual(['conversion']);
  expect(calls[0]!.sig).toBe(`sha256=${await hmacHex(hook.data.secret, calls[0]!.body)}`);

  const test = await post(`/webhooks/${id}/test`, {}, 'editor');
  expect(await test.json()).toEqual({ status: 202 });
  expect(JSON.parse(calls[1]!.body).type).toBe('test');

  expect((await post('/publish', {})).status).toBe(200);
  await vi.waitFor(() => expect(calls.some((c) => JSON.parse(c.body).type === 'publish')).toBe(true));
});

test('GA4/GTM ligados vão para a config publicada; desligados ficam de fora', async () => {
  await post('/entities/integrations', { name: 'integrações', data: { ga4: true, gtm: false } });
  expect((await post('/publish', {})).status).toBe(200);
  expect(JSON.parse(files.get(`${DEMO.accountId}.json`)!).integrations).toEqual([
    ['gtag', 'experiment_impression', '', 'experiment_id', 'variant_id', 'goal'],
  ]);
});

test('consentimento: só vai para a config quando exigido; categoria inválida é recusada', async () => {
  const consent = await t.get<{ id: string }[]>('/entities/consent');
  expect(consent).toEqual([]);
  expect(
    (await post('/entities/consent', { name: 'c', data: { required: true, category: 'a b"<' } })).status,
  ).toBe(400);
  const r = await post('/entities/consent', { name: 'c', data: { required: false, cmp: 'onetrust' } });
  expect(r.status).toBeLessThan(300);
  const { id } = (await r.json()) as { id: string };
  expect((await post('/publish', {})).status).toBe(200);
  expect(JSON.parse(files.get(`${DEMO.accountId}.json`)!).consent).toBeUndefined();

  await t.req(`/entities/consent/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'c', data: { required: true, cmp: 'cookiebot', category: 'marketing' } }),
    as: 'owner',
  });
  expect((await post('/publish', {})).status).toBe(200);
  expect(JSON.parse(files.get(`${DEMO.accountId}.json`)!).consent).toEqual({
    cmp: 'cookiebot',
    category: 'marketing',
  });
  // Sem CMP: o site chama abq.push(['consent', true]).
  await t.req(`/entities/consent/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'c', data: { required: true } }),
    as: 'owner',
  });
  expect((await post('/publish', {})).status).toBe(200);
  expect(JSON.parse(files.get(`${DEMO.accountId}.json`)!).consent).toEqual({});
});

test('Segment/Mixpanel/Amplitude ligados viram destinos; config antiga ({ ga4, gtm }) é convertida ao recompilar', async () => {
  const [e] = await t.get<{ id: string }[]>('/entities/integrations');
  await t.req(`/entities/integrations/${e!.id}`, {
    method: 'PUT',
    as: 'editor',
    body: JSON.stringify({
      name: 'integrações',
      data: {
        mixpanel: { enabled: true, conversions: false },
        segment: { enabled: true, exposureEvent: 'Viu' },
      },
    }),
  });
  expect((await post('/publish', {})).status).toBe(200);
  expect(JSON.parse(files.get(`${DEMO.accountId}.json`)!).integrations).toEqual([
    ['analytics', 'Viu', 'Experiment Converted', 'experiment_id', 'variation_id', 'goal'],
    ['mixpanel', '$experiment_started', '', 'Experiment name', 'Variant name', 'Goal'],
  ]);
  const legacy = { integrations: { ga4: false, gtm: true } } as unknown as PublishedConfig;
  expect(compileAccountScript(legacy, '')).toContain(
    '"integrations":[["dataLayer","abt_exposure","abt_conversion","abt_experiment","abt_variation","abt_goal"]]',
  );
});
