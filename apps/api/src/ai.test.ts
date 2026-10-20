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

/** Pede uma geração e espera terminar (em Node o segundo plano roda na hora). */
async function generateIdeas(t: Awaited<ReturnType<typeof setupApp>>) {
  const r = await t.req('/ai/ideas', { method: 'POST', as: 'editor' });
  expect(r.status).toBe(202);
  expect(((await r.json()) as { status: string }).status).toBe('running');
  for (let i = 0; i < 50; i++) {
    const s = (await (await t.req('/ai/ideas', { as: 'editor' })).json()) as {
      status: string;
      source?: string;
      model?: string;
      ideas: { id: string; title: string; doneAt?: string }[];
    };
    if (s.status !== 'running') return s;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error('geração não terminou');
}

test('rota: gera em segundo plano, guarda, não repete, marca executada, descarta e limpa', async () => {
  const t = await setupApp();
  expect((await t.req('/ai/ideas', { method: 'POST', as: 'viewer' })).status).toBe(403);
  expect(await (await t.req('/ai/ideas', { as: 'viewer' })).json()).toEqual({ status: 'idle', ideas: [] });
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const broken = {
    beta: { messages: { parse: vi.fn().mockRejectedValue(new Error('rede')) } },
  } as unknown as Anthropic;
  // Claude falhando cai nas regras (sem achados = sem ideias, mas a geração termina).
  expect(await generateIdeas(await setupApp({ ai: broken }))).toMatchObject({
    status: 'done',
    source: 'regras',
  });
  err.mockRestore();

  const good = fake({ stop_reason: 'end_turn', parsed_output: { ideas: [idea] } });
  const t3 = await setupApp({ ai: good.client });
  const s1 = await generateIdeas(t3);
  expect(s1).toMatchObject({ status: 'done', source: 'claude', model: 'claude-opus-5-5' });
  expect(s1.ideas.map((i) => i.title)).toEqual([idea.title]);
  // Gerar de novo não duplica a ideia ainda aberta.
  expect((await generateIdeas(t3)).ideas).toHaveLength(1);
  const id = s1.ideas[0]!.id;
  const put = await t3.req(`/ai/ideas/${id}`, {
    method: 'PUT',
    as: 'editor',
    body: JSON.stringify({ done: true }),
  });
  expect(((await put.json()) as { ideas: { doneAt?: string }[] }).ideas[0]!.doneAt).toBeTruthy();
  // Executada não bloqueia a mesma ideia de voltar numa geração nova.
  expect((await generateIdeas(t3)).ideas).toHaveLength(2);
  expect((await t3.req(`/ai/ideas/${id}`, { method: 'DELETE', as: 'editor' })).status).toBe(200);
  expect((await t3.req(`/ai/ideas/${id}`, { method: 'DELETE', as: 'editor' })).status).toBe(404);
  expect(await (await t3.req('/ai/ideas', { method: 'DELETE', as: 'editor' })).json()).toMatchObject({
    ideas: [],
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
  expect(await compatIdeas(cfg, d, f)).toEqual({ model: 'gemini-2.5-flash', ideas: [idea] });
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
  expect((await compatIdeas(cfg, d, f)).ideas[0]!.title).toBe('CTA no topo, agora');
});

test('modelo grátis sobrecarregado (503/429) passa para o próximo da lista', async () => {
  const cfg = compatFromEnv({ AI_BASE_URL: 'https://x.ai/v1', AI_MODEL: 'a, b ,c' })!;
  const d = { insights: [], traffic: { series: [] } } as unknown as Dashboard;
  const ok = new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ideas: [idea] }) } }] }),
  );
  const f = vi
    .fn()
    .mockResolvedValueOnce(new Response('ocupado', { status: 503 }))
    .mockResolvedValueOnce(new Response('cota', { status: 429 }))
    .mockResolvedValueOnce(ok) as unknown as typeof fetch;
  expect((await compatIdeas(cfg, d, f)).model).toBe('c');
  // Erro que não é de sobrecarga (chave inválida) não tenta os outros.
  const bad = vi.fn().mockResolvedValue(new Response('chave', { status: 401 })) as unknown as typeof fetch;
  await expect(compatIdeas(cfg, d, bad)).rejects.toThrow('401');
  expect(bad).toHaveBeenCalledTimes(1);
});
