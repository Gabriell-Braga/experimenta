import { ExperimentSchema, FlagSchema, type SdkConfig } from '@abtest/shared';
import { chooseVariation } from '@abtest/snippet/bucket';
import { expect, test, vi } from 'vitest';
import { createClient } from './index';

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
    FlagSchema.parse({ key: 'novo-frete', enabled: true, rollout: 30, variables: { gratis: true } }),
    FlagSchema.parse({
      key: 'beta-b2b',
      enabled: true,
      rules: [{ attribute: 'plano', op: 'in', value: 'pro, enterprise' }],
    }),
    FlagSchema.parse({ key: 'desligada', enabled: false }),
  ],
  experiments: [exp],
};

test('flags: rollout determinístico ~ percentual, regras de atributo, desligada', async () => {
  const c = await createClient({ accountId: 'acc', cdnUrl: '', config, refreshMs: 0, fetch: vi.fn() });
  const ids = Array.from({ length: 4000 }, (_, i) => `u${i}`);
  const on = ids.filter((id) => c.isEnabled('novo-frete', id)).length / ids.length;
  expect(on).toBeGreaterThan(0.27);
  expect(on).toBeLessThan(0.33);
  expect(c.isEnabled('novo-frete', 'u1')).toBe(c.isEnabled('novo-frete', 'u1'));
  expect(c.isEnabled('beta-b2b', 'x', { plano: 'pro' })).toBe(true);
  expect(c.isEnabled('beta-b2b', 'x', { plano: 'free' })).toBe(false);
  expect(c.isEnabled('desligada', 'x')).toBe(false);
  expect(c.isEnabled('nao-existe', 'x')).toBe(false);
  const enabledUser = ids.find((id) => c.isEnabled('novo-frete', id))!;
  expect(c.getVariables('novo-frete', enabledUser)).toEqual({ gratis: true });
  await c.close();
});

test('campanha server-side: mesma variação que o snippet escolheria; exposição e conversão vão para o /collect', async () => {
  const posts: { events: { type: string }[] }[] = [];
  const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
    posts.push(JSON.parse(String(init!.body)));
    return new Response(null, { status: 204 });
  });
  const c = await createClient({
    accountId: 'acc',
    cdnUrl: '',
    config,
    refreshMs: 0,
    fetch: fetch as never,
    flushMs: 60_000,
  });
  const d = c.getVariation('checkout', 'cliente-9')!;
  expect(d.key).toBe(chooseVariation('cliente-9', exp)!.key);
  expect(d.variables).toEqual(d.key === 'rapido' ? { passos: 1 } : { passos: 3 });
  c.getVariation('checkout', 'cliente-9'); // exposição só uma vez
  c.track('compra', 'cliente-9', { value: 120 });
  await c.flush();
  expect(posts[0]!.events.map((e) => e.type)).toEqual(['exposure', 'event', 'conversion']);
  expect(c.getVariation('nao-existe', 'x')).toBeNull();
  await c.close();
});

test('carrega a config da CDN', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(config), { status: 200 }));
  const c = await createClient({
    accountId: 'acc',
    cdnUrl: 'https://cdn.test/',
    refreshMs: 0,
    fetch: fetch as never,
  });
  expect(fetch).toHaveBeenCalledWith('https://cdn.test/acc.sdk.json');
  expect(c.version).toBe(3);
  await c.close();
});
