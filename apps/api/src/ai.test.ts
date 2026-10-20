import type Anthropic from '@anthropic-ai/sdk';
import { expect, test, vi } from 'vitest';
import { claudeIdeas, compatFromEnv, compatIdeas, ruleIdeas } from './ai';
import type { Dashboard } from './analytics/dashboard';
import type { Insight } from './analytics/insights';
import { autopilotWeights } from './bandit';
import { setupApp } from './test-app';

const insight = (kind: Insight['kind'], extra: Partial<Insight> = {}): Insight => ({
  id: kind,
  kind,
  severity: 'warning',
  title: `achado ${kind}`,
  detail: 'detalhe',
  link: { view: 'heatmap', params: { url: 'http://x.com/carrinho' } },
  ...extra,
});

const idea = {
  title: 'CTA no topo',
  hypothesis: 'Se o CTA subir, mais cliques',
  page: '/',
  change: 'mover CTA',
  metric: 'compra',
  impact: 'alto',
  effort: 'baixo',
  basedOn: 'scroll baixo',
};

/** Cliente falso: só o `beta.messages.parse` que o módulo usa. */
const fake = (res: unknown) => {
  const parse = vi.fn().mockResolvedValue(res);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
};

test('regras: uma ideia por achado acionável, com a página do achado', () => {
  const ideas = ruleIdeas([insight('frustration'), insight('low-scroll'), insight('srm'), insight('winner')]);
  expect(ideas.map((i) => i.title)).toEqual([
    'Tornar clicável o que parece clicável',
    'Subir o CTA e a prova social',
    'Implementar a vencedora',
  ]);
  expect(ideas[0]!.page).toBe('/carrinho');
});

test('Claude: modelo, fallback e saída estruturada; resposta validada', async () => {
  const d = { insights: [insight('low-scroll')], traffic: { series: [] } } as unknown as Dashboard;
  const ok = fake({ stop_reason: 'end_turn', parsed_output: { ideas: [idea] } });
  expect(await claudeIdeas(ok.client, d)).toEqual([idea]);
  const params = ok.parse.mock.calls[0]![0];
  expect(params).toMatchObject({
    model: 'claude-opus-5-5',
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
  });
  expect(params.output_config.format.type).toBe('json_schema');
  expect(params.messages[0].content).toContain('achado low-scroll');

  await expect(claudeIdeas(fake({ stop_reason: 'refusal', parsed_output: null }).client, d)).rejects.toThrow(
    'refusal',
  );
  await expect(
    claudeIdeas(fake({ stop_reason: 'end_turn', parsed_output: { ideas: [{ title: 1 }] } }).client, d),
  ).rejects.toThrow('formato');
});

test('rota: sem chave usa regras; com Claude falhando também cai nas regras; viewer não pede', async () => {
  const t = await setupApp();
  const post = (as: string) => t.req('/ai/ideas', { method: 'POST', as });
  expect((await post('viewer')).status).toBe(403);
  expect(await (await post('editor')).json()).toMatchObject({ source: 'regras' });
  const broken = {
    beta: { messages: { parse: vi.fn().mockRejectedValue(new Error('rede')) } },
  } as unknown as Anthropic;
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const t2 = await setupApp({ ai: broken });
  expect(await (await t2.req('/ai/ideas', { method: 'POST', as: 'editor' })).json()).toMatchObject({
    source: 'regras',
  });
  err.mockRestore();
  const good = fake({ stop_reason: 'end_turn', parsed_output: { ideas: [idea] } });
  const t3 = await setupApp({ ai: good.client });
  expect(await (await t3.req('/ai/ideas', { method: 'POST', as: 'editor' })).json()).toEqual({
    source: 'claude',
    model: 'claude-opus-5-5',
    ideas: [idea],
  });
}, 30_000); // três apps com banco cada

test('piloto automático: perdedora sai e não volta; com vencedora, só ela recebe tráfego', () => {
  const exp = (w: number[]) => ({ variations: w.map((weight) => ({ weight })) });
  const v = (...xs: string[]) => xs.map((verdict) => ({ verdict }));
  expect(autopilotWeights([400, 300, 300], v('baseline', 'loser', 'leading'), exp([1, 1, 1]))).toEqual([
    400, 0, 300,
  ]);
  // Pausada antes continua pausada, mesmo sem veredito agora.
  expect(autopilotWeights([400, 300, 300], v('baseline', 'inconclusive', 'leading'), exp([1, 0, 1]))).toEqual(
    [400, 0, 300],
  );
  expect(autopilotWeights([100, 800, 100], v('baseline', 'winner', 'inconclusive'), exp([1, 1, 1]))).toEqual([
    0, 800, 0,
  ]);
  // Nunca zera tudo.
  expect(autopilotWeights([500, 500], v('baseline', 'loser'), exp([0, 1]))).toEqual([500, 500]);
});

test('modelo grátis (API compatível com OpenAI): liga por env, manda o painel e valida a resposta', async () => {
  expect(compatFromEnv({})).toBeUndefined();
  const cfg = compatFromEnv({
    AI_BASE_URL: 'https://x.ai/v1/',
    AI_MODEL: 'gemini-2.5-flash',
    AI_API_KEY: 'k',
  })!;
  expect(cfg.baseUrl).toBe('https://x.ai/v1');
  const d = { insights: [insight('low-scroll')], traffic: { series: [] } } as unknown as Dashboard;
  const reply = (content: string, status = 200) =>
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
      ) as unknown as typeof fetch;

  const f = reply('```json\n' + JSON.stringify({ ideas: [idea] }) + '\n```');
  expect(await compatIdeas(cfg, d, f)).toEqual([idea]);
  const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
  expect(url).toBe('https://x.ai/v1/chat/completions');
  expect(init.headers.authorization).toBe('Bearer k');
  const body = JSON.parse(init.body);
  expect(body.model).toBe('gemini-2.5-flash');
  expect(body.messages[1].content).toContain('achado low-scroll');

  await expect(compatIdeas(cfg, d, reply('não sei'))).rejects.toThrow('não é JSON');
  await expect(compatIdeas(cfg, d, reply('{"ideas":[{"title":1}]}'))).rejects.toThrow('formato');
  await expect(compatIdeas(cfg, d, reply('', 429))).rejects.toThrow('429');
});

test('modelo grátis: travessão na resposta vira vírgula', async () => {
  const cfg = compatFromEnv({ AI_BASE_URL: 'https://x.ai/v1', AI_MODEL: 'm' })!;
  const d = { insights: [], traffic: { series: [] } } as unknown as Dashboard;
  const content = JSON.stringify({ ideas: [{ ...idea, title: 'CTA no topo — agora' }] });
  const f = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }] })),
    ) as unknown as typeof fetch;
  expect((await compatIdeas(cfg, d, f))[0]!.title).toBe('CTA no topo, agora');
});
