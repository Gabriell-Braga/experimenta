// Vetores de compatibilidade dos SDKs server-side (sdks/test-vectors.json): as decisões deste SDK (que usa o
// mesmo bucketing do snippet) sobre um sdk.json de exemplo. Os SDKs de Python, PHP, Go e Java leem o arquivo e
// conferem decisão por decisão. Mudou o bucketing/regras de propósito? `pnpm --filter @abtest/sdk vectors`.
import { ExperimentSchema, FlagSchema, type SdkConfig } from '@abtest/shared';
import { flagRuleMatches } from '@abtest/shared/sdk-config';
import { murmurhash3 } from '@abtest/snippet/bucket';
import { expect, test, vi } from 'vitest';
import { createClient } from './index';

const variation = (id: string, weight: number, variables: Record<string, unknown> = {}) => ({
  id,
  key: id,
  name: id,
  weight,
  variables,
});
const exp = (id: string, o: Record<string, unknown>) =>
  ExperimentSchema.parse({ id, key: id, name: id, status: 'running', type: 'server', ...o });
const slots = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

const experiments = [
  exp('meio-a-meio', {
    variations: [variation('a', 50, { passos: 3 }), variation('b', 50, { passos: 1, rotulo: 'Rápido' })],
    goals: [
      { id: 'g1', key: 'compra', type: 'custom', event: 'compra' },
      { id: 'g2', key: 'clique', type: 'click', selector: '#x' },
    ],
  }),
  exp('pesos', {
    variations: [variation('p1', 1), variation('p2', 2), variation('p7', 7)],
    goals: [{ id: 'g3', key: 'compra-pesos', type: 'custom', event: 'compra' }],
  }),
  exp('peso-zero', { variations: [variation('z0', 0), variation('z1', 1), variation('z2', 1)] }),
  exp('trafego-parcial', { traffic: 37.5, variations: [variation('t1', 50), variation('t2', 50)] }),
  exp('trafego-minimo', { traffic: 0.05, variations: [variation('m1', 1), variation('m2', 1)] }),
  exp('trafego-arredondado', { traffic: 12.345, variations: [variation('r1', 3), variation('r2', 1)] }),
  exp('trafego-zero', { traffic: 0, variations: [variation('x1', 1), variation('x2', 1)] }),
  ...[
    ['grupo-1', 0, 33],
    ['grupo-2', 33, 66],
    ['grupo-3', 66, 100],
  ].map(([id, from, to]) =>
    exp(id as string, {
      group: { id: 'grp-exclusivo', slots: slots(from as number, to as number) },
      variations: [variation(`${id}-a`, 1), variation(`${id}-b`, 1)],
      goals: [{ id: `${id}-g`, key: `${id}-conv`, type: 'custom', event: 'assinatura' }],
    }),
  ),
  exp('grupo-vazio', { group: { id: 'grp-vazio', slots: [] }, variations: [variation('v1', 1)] }),
];

const flags = [
  FlagSchema.parse({ key: 'rollout-30', enabled: true, rollout: 30, variables: { gratis: true, limite: 3 } }),
  FlagSchema.parse({ key: 'rollout-fracionado', enabled: true, rollout: 12.345 }),
  FlagSchema.parse({ key: 'rollout-0', enabled: true, rollout: 0 }),
  FlagSchema.parse({ key: 'rollout-100', enabled: true }),
  FlagSchema.parse({ key: 'desligada', enabled: false }),
  FlagSchema.parse({
    key: 'regras',
    enabled: true,
    rollout: 50,
    variables: { tema: 'escuro' },
    rules: [
      { attribute: 'plano', op: 'in', value: 'pro, enterprise' },
      { attribute: 'idade', op: 'gte', value: '18' },
      { attribute: 'pais', op: 'neq', value: 'BR' },
    ],
  }),
];

const config: SdkConfig = {
  accountId: 'acc-vetores',
  version: 7,
  publishedAt: '2026-10-20T00:00:00.000Z',
  trackingUrl: 'https://api.test/collect',
  flags,
  experiments: experiments.map(({ id, key, traffic, variations, goals, group }) => ({
    id,
    key,
    traffic,
    variations,
    goals,
    group,
  })),
};

/** Ids difíceis: vazio, acentos (NFC e NFD), 2/3/4 bytes em UTF-8, emoji com ZWJ, NUL, BOM, todos os restos (len & 3). */
const unicodeUsers = [
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'abcde',
  'José',
  'José',
  'ção',
  'Ω≈ç√',
  '日本語',
  '😀',
  '👨\u200D👩\u200D👧',
  '\u0000',
  '\uFEFFbom',
  ' espaço ',
  'user-123@exemplo.com',
  'x'.repeat(1000),
  '🇧🇷🇵🇾',
  '\u{10FFFF}',
];
const users = [...unicodeUsers, ...Array.from({ length: 150 }, (_, i) => `u${i}`)];

const attributeSets: Record<string, string | number | boolean>[] = [
  {},
  { plano: 'pro', idade: 30, pais: 'PY' },
  { plano: 'enterprise', idade: '18', pais: 'AR' },
  { plano: 'pro', idade: 17, pais: 'PY' },
  { plano: 'pro', idade: 40, pais: 'BR' },
  { plano: 'free', idade: 40 },
  { plano: 'pro', idade: ' 21 ' },
  { plano: 'pro', idade: 'vinte' },
];

type Attr = string | number | boolean;
const rule = (op: string, value: string, attr?: Attr) => ({
  rule: { attribute: 'a', op, value },
  attributes: attr === undefined ? {} : { a: attr },
});
/** Conversões de tipo do JS (String(v), Number(v), trim) que cada linguagem precisa imitar. */
const ruleCases = [
  rule('eq', 'pro', 'pro'),
  rule('eq', 'pro', 'Pro'),
  rule('eq', 'pro'),
  rule('neq', 'pro'),
  rule('neq', 'pro', 'pro'),
  rule('neq', 'pro', 'free'),
  rule('eq', 'true', true),
  rule('eq', 'false', false),
  rule('eq', 'True', true),
  rule('eq', '10', 10),
  rule('eq', '10.0', 10),
  rule('eq', '1.5', 1.5),
  rule('eq', '-0.5', -0.5),
  rule('eq', '0.30000000000000004', 0.1 + 0.2),
  rule('eq', '10000000000000000', 1e16),
  rule('eq', '123456789012345680000', 123456789012345680000),
  rule('eq', '1e+21', 1e21),
  rule('eq', '1.5e+300', 1.5e300),
  rule('eq', '0.000001', 0.000001),
  rule('eq', '1e-7', 1e-7),
  rule('eq', '1.25e-7', 1.25e-7),
  rule('eq', '0', -0),
  rule('in', 'pro, enterprise', 'enterprise'),
  rule('in', 'pro, enterprise', 'pro'),
  rule('in', 'pro, enterprise', 'ent'),
  rule('in', ' pro ,\tenterprise\u00A0', 'enterprise'),
  rule('in', 'a,,b', ''),
  rule('in', 'a,b', ' a'),
  rule('in', '1, 2, 3', 2),
  rule('in', 'true,false', true),
  rule('in', 'x\u2003,y', 'x'),
  rule('in', 'x\u0085,y', 'x'),
  rule('contains', '@empresa.com', 'ana@empresa.com'),
  rule('contains', '@empresa.com', 'ana@outra.com'),
  rule('contains', '', 'qualquer'),
  rule('contains', 'ção', 'Promoção'),
  rule('contains', '1', 210),
  rule('gte', '18', 18),
  rule('gte', '18', 17.99),
  rule('gte', '18', '18'),
  rule('gte', '18', ' 18 '),
  rule('gte', '18', '\n\t19\u00A0'),
  rule('gte', '18', '\u3000 20 \u2028'),
  rule('gte', '18', '\u0085 20'),
  rule('gte', '0', ''),
  rule('gte', '0', '   '),
  rule('gte', '0', 'abc'),
  rule('gte', '0', '12px'),
  rule('gte', '0', '1_000'),
  rule('gte', '16', '0x10'),
  rule('gte', '16', '0X0f'),
  rule('lte', '5', '0b101'),
  rule('lte', '15', '0o17'),
  rule('gte', '0', '-0x10'),
  rule('gte', '1000', '1e3'),
  rule('gte', '0.5', '.5'),
  rule('gte', '5', '5.'),
  rule('gte', '5', '+5'),
  rule('lte', '-5', '-5'),
  rule('gte', '1', true),
  rule('lte', '0', false),
  rule('gte', '1e308', 'Infinity'),
  rule('lte', '-1e308', '-Infinity'),
  rule('gte', '0', '+Infinity'),
  rule('gte', '0', 'infinity'),
  rule('gte', '1e308', '1e400'),
  rule('gte', 'abc', 10),
  rule('lte', '', 0),
  rule('lte', '', -1),
  rule('gte', ' 7 ', 7),
  rule('gte', '0', 'NaN'),
  rule('gte', '0', '٣'),
  rule('gte', '0', '１２'),
  rule('gte', '0', '1e'),
  rule('gte', '0', '.'),
  rule('gte', '-1', '-.5e-3'),
  rule('gte', '12', '00012'),
  rule('gte', '0', '0b12'),
  rule('gte', '0', '1.2.3'),
  rule('lte', '2.5', 2.5),
  rule('lte', '2.5', 2.5000001),
  rule('gte', '18'),
  rule('lte', '18'),
  rule('contains', 'x'),
  rule('in', 'x'),
];

const MURMUR_INPUTS = [...unicodeUsers, 'u1meio-a-meio', 'cliente-9checkout', 'The quick brown fox'];

/** Sequência de chamadas e os eventos que vão para o /collect (sem eventId/ts, que são aleatórios). */
type Call =
  | { call: 'getVariation'; experiment: string; userId: string }
  | { call: 'track'; event: string; userId: string; value?: number; props?: Record<string, Attr> };
const calls: Call[] = [
  ...['u1', 'u2', 'u3', 'José', '😀'].map((userId) => ({
    call: 'getVariation' as const,
    experiment: 'meio-a-meio',
    userId,
  })),
  { call: 'getVariation', experiment: 'meio-a-meio', userId: 'u1' },
  { call: 'getVariation', experiment: 'trafego-zero', userId: 'u1' },
  { call: 'getVariation', experiment: 'nao-existe', userId: 'u1' },
  ...['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((userId) => ({
    call: 'getVariation' as const,
    experiment: 'grupo-2',
    userId,
  })),
  { call: 'track', event: 'compra', userId: 'u1', value: 199.9 },
  { call: 'track', event: 'compra', userId: '😀', props: { origem: 'app', itens: 2, cupom: false } },
  { call: 'track', event: 'assinatura', userId: 'u4' },
  { call: 'track', event: 'assinatura', userId: 'u5', value: 0 },
  { call: 'track', event: 'sem-meta', userId: 'u2', value: -1.5 },
];

const newClient = async (posts: { events: Record<string, unknown>[] }[] = []) =>
  createClient({
    accountId: config.accountId,
    cdnUrl: '',
    config,
    refreshMs: 0,
    flushMs: 3_600_000,
    fetch: vi.fn(async (_u: string, init?: RequestInit) => {
      posts.push(JSON.parse(String(init!.body)));
      return new Response(null, { status: 204 });
    }) as never,
  });

/** Roda `calls` num cliente novo: resultado de cada chamada e os eventos enviados (sem eventId/ts). */
async function trackScenario() {
  const posts: { events: Record<string, unknown>[] }[] = [];
  const c = await newClient(posts);
  const results = calls.map((x) => {
    if (x.call === 'track') return (c.track(x.event, x.userId, { value: x.value, props: x.props }), null);
    const d = c.getVariation(x.experiment, x.userId);
    return d && { key: d.key, variables: d.variables };
  });
  await c.close();
  const events = posts.flatMap((p) =>
    p.events.map(({ eventId, ts, ...rest }) => {
      expect(typeof eventId).toBe('string');
      expect(typeof ts).toBe('number');
      return rest;
    }),
  );
  return { calls: calls.map((x, i) => ({ ...x, result: results[i] })), events };
}

test('sdks/test-vectors.json está atualizado com as decisões do SDK TS', async () => {
  const track = await trackScenario();
  const c = await newClient();
  const out = {
    $comentario:
      'Gerado por packages/sdk/src/vectors.test.ts (pnpm --filter @abtest/sdk vectors). Não edite à mão.',
    config,
    murmur3: MURMUR_INPUTS.map((input) => ({ input, hash: murmurhash3(input) })),
    users,
    experiments: config.experiments.map((e) => ({
      key: e.key,
      variations: users.map((u) => c.getVariation(e.key, u)?.key ?? null),
    })),
    flags: flags.flatMap((f) =>
      (f.rules.length ? attributeSets : [{}]).map((attributes) => ({
        key: f.key,
        attributes,
        enabled: users.map((u) => c.isEnabled(f.key, u, attributes)),
      })),
    ),
    rules: ruleCases.map((r) => ({ ...r, match: flagRuleMatches(r.rule as never, r.attributes) })),
    track,
  };
  await c.close();
  await expect(JSON.stringify(out, null, 2) + '\n').toMatchFileSnapshot('../../../sdks/test-vectors.json');
});
