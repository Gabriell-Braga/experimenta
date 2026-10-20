import { ExperimentSchema, FlagSchema, TrackingEventSchema, type SdkConfig } from '@abtest/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createMobileClient, memoryStorage, type AppStateLike, type MobileClientOptions } from './client';

const exp = ExperimentSchema.parse({
  id: 'e1',
  key: 'checkout',
  name: 'Checkout',
  status: 'running',
  type: 'server',
  variations: [
    { id: 'a', key: 'atual', name: 'Atual', weight: 50, variables: { passos: 3 } },
    { id: 'b', key: 'rapido', name: 'Rápido', weight: 50, variables: { passos: 1 } },
  ],
  goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
});
const config: SdkConfig = {
  accountId: 'acc',
  version: 3,
  publishedAt: '',
  trackingUrl: 'https://api.test/collect',
  flags: [
    FlagSchema.parse({ key: 'tudo', enabled: true, variables: { cor: 'azul' } }),
    FlagSchema.parse({
      key: 'so-android-2',
      enabled: true,
      rules: [
        { attribute: 'platform', op: 'eq', value: 'android' },
        { attribute: 'appVersion', op: 'gte', value: '2' },
      ],
    }),
    FlagSchema.parse({ key: 'pro', enabled: true, rules: [{ attribute: 'plano', op: 'eq', value: 'pro' }] }),
  ],
  experiments: [exp],
};

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
  vi.useRealTimers();
});

/** Servidor falso: CDN devolve `cdn` (ou falha), /collect responde `status()` e guarda os lotes. */
function server(o: { cdn?: SdkConfig | 'offline'; status?: () => number } = {}) {
  const posts: Record<string, unknown>[][] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('.sdk.json')) {
      if (o.cdn === 'offline' || !o.cdn) throw new TypeError('Network request failed');
      return new Response(JSON.stringify(o.cdn));
    }
    const s = o.status?.() ?? 204;
    if (s === 0) throw new TypeError('Network request failed');
    if (s < 300) posts.push(JSON.parse(String(init!.body)).events);
    return new Response(null, { status: s });
  });
  return { posts, fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch.mock.calls };
}

function client(o: Partial<MobileClientOptions> = {}) {
  const c = createMobileClient({ accountId: 'acc', cdnUrl: 'https://cdn.test', flushMs: 3_600_000, ...o });
  closers.push(c.close);
  return c;
}

test('1ª abertura: gera e guarda o id do visitante, baixa a config e decide; 2ª abertura usa o mesmo id', async () => {
  const storage = memoryStorage();
  const s = server({ cdn: config });
  const c = client({ storage, fetch: s.fetch });
  expect(c.isEnabled('tudo')).toBe(false); // antes de pronto
  expect(c.getVariation('checkout')).toBeNull();
  await c.ready;
  expect(c.visitorId).toMatch(/.{8,}/);
  expect(c.isEnabled('tudo')).toBe(true);
  expect(c.getVariables('tudo')).toEqual({ cor: 'azul' });
  expect(c.version).toBe(3);
  const c2 = client({ storage, fetch: server().fetch }); // offline: usa a config do cache
  await c2.ready;
  expect(c2.visitorId).toBe(c.visitorId);
  expect(c2.isEnabled('tudo')).toBe(true);
});

test('atributos do aparelho, fixos, do identify e da chamada entram nas regras', async () => {
  const c = client({
    config,
    device: { platform: 'android', osVersion: '14', type: 'mobile' },
    appVersion: '2.1.0',
  });
  await c.ready;
  expect(c.isEnabled('so-android-2')).toBe(false); // '2.1.0' não é número
  expect(c.isEnabled('so-android-2', { appVersion: 2.1 })).toBe(true);
  expect(c.isEnabled('pro')).toBe(false);
  c.identify('cli-9', { plano: 'pro' });
  expect(c.isEnabled('pro')).toBe(true);
  const ios = client({ config, device: { platform: 'ios', type: 'tablet' }, attributes: { appVersion: 3 } });
  await ios.ready;
  expect(ios.isEnabled('so-android-2')).toBe(false);
});

test('atribuição fica guardada: mudar os pesos depois não troca a variação de quem já viu', async () => {
  const storage = memoryStorage();
  const c = client({ storage, config, visitorId: 'v-1' });
  await c.ready;
  const first = c.getVariation('checkout')!;
  await c.close();
  const other = first.key === 'atual' ? 'b' : 'a';
  const moved: SdkConfig = {
    ...config,
    experiments: [
      { ...exp, variations: exp.variations.map((v) => ({ ...v, weight: v.id === other ? 100 : 0 })) },
    ],
  };
  const c2 = client({ storage, config: moved, visitorId: 'v-1' });
  await c2.ready;
  expect(c2.getVariation('checkout')).toEqual(first);
  const fresh = client({ config: moved, visitorId: 'v-1' }); // sem histórico: segue os pesos novos
  await fresh.ready;
  expect(fresh.getVariation('checkout')?.key).not.toBe(first.key);
});

test('eventos: exposição uma vez, conversão da meta, tela como pageview; tudo válido no /collect', async () => {
  const s = server();
  const c = client({
    config,
    fetch: s.fetch,
    appId: 'com.loja',
    device: { platform: 'ios', osVersion: '17.4', type: 'mobile', width: 390.4 },
    appVersion: '1.2.0',
  });
  c.screen('Home'); // antes de pronto: espera o id do visitante
  await c.ready;
  const v = c.getVariation('checkout')!;
  c.getVariation('checkout');
  c.screen('Carrinho');
  c.track('compra', { value: 99.9, props: { itens: 2 } });
  c.track('outro');
  c.identify('cli-1', { plano: 'pro' });
  await c.flush();
  const events = s.posts.flat();
  for (const e of events) expect(TrackingEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
  expect(events.map((e) => e.type)).toEqual([
    'identify', // atributos do aparelho, uma vez por abertura
    'pageview',
    'exposure',
    'pageview',
    'event',
    'conversion',
    'event',
    'identify',
  ]);
  expect(events[0]).toMatchObject({ attrs: { platform: 'ios', osVersion: '17.4', appVersion: '1.2.0' } });
  expect(events[1]).toMatchObject({ url: 'app://com.loja/Home', title: 'Home', device: 'mobile', vw: 390 });
  expect(events[2]).toMatchObject({
    experimentKey: 'checkout',
    variationKey: v.key,
    url: 'app://com.loja/Home',
  });
  expect(events[5]).toMatchObject({ goalKey: 'compra', value: 99.9, url: 'app://com.loja/Carrinho' });
  expect(events[7]).toMatchObject({ userId: 'cli-1', attrs: { plano: 'pro' } });
  expect(new Set(events.map((e) => e.visitorId))).toEqual(new Set([c.visitorId]));
  expect(new Set(events.map((e) => e.sessionId)).size).toBe(1);
});

test('offline: fila fica guardada e sai na próxima abertura; 4xx descarta, 5xx e 429 seguram', async () => {
  const storage = memoryStorage();
  let status = 0; // rede fora
  const s = server({ status: () => status });
  const c = client({ storage, config, fetch: s.fetch, visitorId: 'v' });
  await c.ready;
  c.track('a');
  c.track('b');
  await c.flush();
  await c.close();
  expect(s.posts).toEqual([]);

  status = 503;
  const c2 = client({ storage, config, fetch: s.fetch, visitorId: 'v', batchSize: 1 });
  await c2.ready;
  await c2.flush();
  status = 429;
  await c2.flush();
  expect(s.posts).toEqual([]);
  status = 204;
  await c2.flush();
  expect(s.posts.map((b) => b.map((e) => e.name))).toEqual([['a'], ['b']]); // lotes de 1, em ordem
  status = 400;
  c2.track('c');
  await c2.flush();
  status = 204;
  await c2.flush();
  expect(s.posts.flat().map((e) => e.name)).toEqual(['a', 'b']); // 'c' descartado (lote inválido)
});

test('teto da fila descarta os mais antigos', async () => {
  const s = server();
  const c = client({ config, fetch: s.fetch, maxQueue: 3, visitorId: 'v' });
  await c.ready;
  for (const n of ['1', '2', '3', '4', '5']) c.track(n);
  await c.flush();
  expect(s.posts.flat().map((e) => e.name)).toEqual(['3', '4', '5']);
});

test('AppState: background envia a fila; volta depois de 30 min = sessão nova e config recarregada', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let listener: (s: string) => void = () => {};
  const appState: AppStateLike = {
    addEventListener: (_t, l) => ((listener = l), { remove: () => (listener = () => {}) }),
  };
  const s = server({ cdn: config });
  const c = client({ fetch: s.fetch, appState, refreshMs: 60_000 });
  await c.ready;
  c.track('antes');
  await Promise.resolve();
  listener('background');
  await vi.waitFor(() => expect(s.posts.flat().map((e) => e.name)).toContain('antes'));
  const sdkLoads = () => s.calls.filter(([u]) => String(u).endsWith('.sdk.json')).length;
  expect(sdkLoads()).toBe(1);
  vi.setSystemTime(Date.now() + 31 * 60_000);
  listener('active');
  c.track('depois');
  await c.flush();
  const [a, b] = ['antes', 'depois'].map((n) => s.posts.flat().find((e) => e.name === n)!);
  expect(a!.sessionId).not.toBe(b!.sessionId);
  expect(sdkLoads()).toBe(2);
  await c.close();
  listener('background'); // listener removido no close
});

test('storage com erro não derruba o app (segue em memória)', async () => {
  const broken = {
    getItem: () => Promise.reject(new Error('quota')),
    setItem: () => Promise.reject(new Error('quota')),
  };
  const s = server();
  const c = client({ storage: broken, config, fetch: s.fetch });
  await c.ready;
  c.track('x');
  await c.flush();
  expect(s.posts.flat().map((e) => e.name)).toEqual(['x']);
});
