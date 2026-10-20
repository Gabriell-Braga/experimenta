import type Anthropic from '@anthropic-ai/sdk';
import { expect, test, vi } from 'vitest';
import { ExperimentSchema } from '@abtest/shared';
import { claudeIdeas, compatFromEnv, compatIdeas, ruleIdeas } from './ai';
import type { Dashboard } from './analytics/dashboard';
import type { Insight } from './analytics/insights';
import { autopilotWeights } from './bandit';
import { effectiveStage, ideaGoal, ideaPage, ideaResult, migrate } from './routes/ai';
import { DEMO } from './seed';
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
      ideas: { id: string; title: string; stage: string }[];
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
  expect(((await put.json()) as { ideas: { stage: string }[] }).ideas[0]!.stage).toBe('done');
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
  // Piora meta de guarda: sai como perdedora.
  expect(
    autopilotWeights(
      [400, 300, 300],
      [{ verdict: 'baseline' }, { verdict: 'leading', guardrailViolated: true }, { verdict: 'leading' }],
      exp([1, 1, 1]),
    ),
  ).toEqual([400, 0, 300]);
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

test('ideia → teste: página e meta a partir do texto da ideia', () => {
  const site = 'http://loja.com/';
  expect(ideaPage('/carrinho', site)).toEqual({
    url: 'http://loja.com/carrinho',
    rule: { match: 'exact', value: 'http://loja.com/carrinho', exclude: false },
  });
  expect(ideaPage('/produto/* (páginas de produto)', site)).toEqual({
    url: 'http://loja.com/produto/',
    rule: { match: 'contains', value: 'http://loja.com/produto/', exclude: false },
  });
  expect(ideaPage('http://loja.com/a?b=1', site).rule?.value).toBe('http://loja.com/a?b=1');
  // Outro site, texto solto: home do projeto, sem regra de URL.
  expect(ideaPage('http://outro.com/a', site)).toEqual({ url: site });
  expect(ideaPage('todo o site', site)).toEqual({ url: site });
  expect(ideaPage('javascript:alert(1)', site)).toEqual({ url: site });

  const goals = [
    { id: 'g1', key: 'compra', type: 'custom', event: 'purchase' },
    { id: 'g2', key: 'envio-formulario', type: 'formSubmit', selector: 'form' },
    { id: 'g3', key: 'clique-cta', type: 'click', selector: '#cta' },
  ] as const;
  const g = (m: string) => ideaGoal(m, [...goals]);
  // Mais específica que casa; id novo (metas são por experimento).
  expect(g('Envio do formulário de contato')).toMatchObject({
    created: false,
    goal: { key: 'envio-formulario', type: 'formSubmit', selector: 'form' },
  });
  expect(g('Envio do formulário').goal.id).not.toBe('g2');
  expect(g('taxa de compra').goal.key).toBe('compra');
  expect(g('Purchase rate').goal.key).toBe('compra');
  // Sem meta parecida: evento customizado com o nome do texto.
  expect(g('Conclusão do funil')).toMatchObject({
    created: true,
    goal: { key: 'conclusao-funil', type: 'custom', event: 'conclusao-funil' },
  });
  expect(ideaGoal('!!!', []).goal.key).toBe('conversao');
});

test('rota: criar teste da ideia (dados, vínculo, idempotência, permissões, auditoria)', async () => {
  const good = fake({
    stop_reason: 'end_turn',
    parsed_output: { ideas: [{ ...idea, page: '/loja/', metric: 'Cliques no CTA' }] },
  });
  const t = await setupApp({ ai: good.client });
  const ideaId = (await generateIdeas(t)).ideas[0]!.id;
  const path = `/ai/ideas/${ideaId}/experiment`;
  expect((await t.req(path, { method: 'POST', as: 'viewer' })).status).toBe(403);
  expect((await t.req(path, { method: 'POST', as: 'other' })).status).toBe(404);
  expect((await t.req('/ai/ideas/idea_x/experiment', { method: 'POST', as: 'editor' })).status).toBe(404);

  // Meta "clique-cta" já usada noutro teste da conta: reaproveitada.
  const base = (
    await t.req('/experiments', {
      method: 'POST',
      as: 'editor',
      body: JSON.stringify({
        projectId: (await t.repo.listProjects(DEMO.accountId))[0]!.id,
        editorUrl: 'http://localhost:5180/',
        experiment: {
          id: 'exp_base',
          key: 'base',
          name: 'Base',
          variations: [{ id: 'v0', key: 'controle', name: 'Controle', weight: 1 }],
          goals: [{ id: 'gb', key: 'clique-cta', type: 'click', selector: '#cta' }],
        },
      }),
    })
  ).status;
  expect(base).toBe(201);

  // Clique duplo simultâneo: um teste só.
  const [r1, r2] = await Promise.all([
    t.req(path, { method: 'POST', as: 'editor' }),
    t.req(path, { method: 'POST', as: 'editor' }),
  ]);
  const b1 = (await r1.json()) as { id: string; created: boolean; ai: boolean; goalCreated: boolean };
  const b2 = (await r2.json()) as { id: string };
  expect(r1.status).toBe(200);
  expect(b2.id).toBe(b1.id);
  expect(b1).toMatchObject({ ai: true, goalCreated: false });
  const again = (await (await t.req(path, { method: 'POST', as: 'editor' })).json()) as {
    id: string;
    created: boolean;
    ideas: { ideas: { id: string; stage: string; experimentId?: string }[] };
  };
  expect(again).toMatchObject({ id: b1.id, created: false });
  expect(again.ideas.ideas[0]).toMatchObject({
    experimentId: b1.id,
    stage: 'testing',
    experimentName: idea.title,
  });
  expect((await t.repo.listExperiments(DEMO.accountId)).map((e) => e.id).sort()).toEqual(
    [b1.id, 'exp_base'].sort(),
  );

  const rec = (await t.repo.getExperiment(DEMO.accountId, b1.id))!;
  expect(rec.editorUrl).toBe('http://localhost:5180/loja/');
  expect(rec.experiment).toMatchObject({
    name: idea.title,
    hypothesis: idea.hypothesis,
    status: 'draft',
    segmentation: { urls: [{ match: 'exact', value: 'http://localhost:5180/loja/' }] },
    goals: [{ key: 'clique-cta', type: 'click', selector: '#cta' }],
  });
  expect(rec.experiment.variations.map((v) => v.key)).toEqual(['controle', 'variacao-1']);
  const acts = await t.repo.listActivities(DEMO.accountId, {});
  expect(acts.filter((a) => a.targetId === b1.id && a.action === 'create')).toHaveLength(1);

  // Sem provedor de IA (ideia por regras): cria igual; o editor só sugere o texto da mudança.
  const t2 = await setupApp();
  await t2.repo.saveEntity(DEMO.accountId, {
    kind: 'ai-ideas',
    name: 'ideias',
    data: {
      status: 'done',
      ideas: [{ ...idea, id: 'idea_r1', createdAt: new Date().toISOString(), source: 'regras' }],
    },
  });
  const r3 = await t2.req('/ai/ideas/idea_r1/experiment', { method: 'POST', as: 'editor' });
  expect(await r3.json()).toMatchObject({ id: 'exp_idea_r1', created: true, ai: false, goalCreated: true });
}, 30_000);

test('backlog: migração, coluna pelo status do teste e resultado do relatório', () => {
  const base = {
    ...idea,
    impact: 'alto' as const,
    effort: 'baixo' as const,
    id: 'i',
    createdAt: '',
    source: 'claude' as const,
  };
  expect(migrate(base).stage).toBe('idea');
  expect(migrate({ ...base, doneAt: 'x' }).stage).toBe('done');
  expect(migrate({ ...base, doneAt: 'x', experimentId: 'e' }).stage).toBe('testing');
  expect(migrate({ ...base, stage: 'prioritized', doneAt: 'x' }).stage).toBe('prioritized');
  expect(effectiveStage('prioritized')).toBe('prioritized');
  expect(effectiveStage('testing', 'running')).toBe('testing');
  expect(effectiveStage('testing', 'draft')).toBe('testing');
  expect(effectiveStage('testing', 'archived')).toBe('done');
  expect(effectiveStage('done', 'running')).toBe('done');

  const exp = ExperimentSchema.parse({
    id: 'e',
    key: 'e',
    name: 'E',
    status: 'archived',
    variations: [
      { id: 'c', key: 'c', name: 'Controle', weight: 1 },
      { id: 'a', key: 'a', name: 'Verde', weight: 1 },
      { id: 'b', key: 'b', name: 'Azul', weight: 1 },
    ],
    goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
  });
  const arm = (variationId: string, verdict: string, lift: number | null) => ({
    variationId,
    verdict,
    lift,
    visitors: 100,
  });
  const report = (...arms: ReturnType<typeof arm>[]) =>
    ({ goals: [{ goalKey: 'compra', arms: [arm('c', 'baseline', null), ...arms] }] }) as never;
  const now = new Date('2026-10-20T00:00:00Z');
  expect(ideaResult(exp, report(arm('a', 'leading', 0.05), arm('b', 'winner', 0.12)), now)).toEqual({
    outcome: 'winner',
    lift: 0.12,
    variation: 'Azul',
    goal: 'compra',
    visitors: 300,
    at: now.toISOString(),
    final: true,
  });
  expect(ideaResult(exp, report(arm('a', 'loser', -0.2), arm('b', 'loser', -0.1)))).toMatchObject({
    outcome: 'loser',
    lift: -0.1,
    variation: 'Azul',
  });
  expect(ideaResult(exp, report(arm('a', 'inconclusive', 0.01), arm('b', 'loser', -0.1)))).toMatchObject({
    outcome: 'inconclusive',
    variation: 'Verde',
  });
  expect(ideaResult(exp, { goals: [] })).toBeNull();
});

test('rota: backlog (ideia manual, ICE, mover, ligar a teste, resultado, auditoria, migração)', async () => {
  const t = await setupApp();
  const put = (id: string, body: unknown, as = 'editor') =>
    t.req(`/ai/ideas/${id}`, { method: 'PUT', as, body: JSON.stringify(body) });
  const board = async () => (await (await t.req('/ai/ideas', { as: 'viewer' })).json()) as Board;
  type Board = {
    id?: string;
    ideas: {
      id: string;
      stage: string;
      score?: number;
      source: string;
      createdBy?: string;
      experimentId?: string;
      experimentStatus?: string;
      result?: unknown;
    }[];
  };
  const manual = { title: 'Frete grátis no topo', hypothesis: 'Se mostrar, compra mais', page: '/' };
  const post = (body: unknown, as = 'editor') =>
    t.req('/ai/ideas/manual', { method: 'POST', as, body: JSON.stringify(body) });
  expect((await post(manual, 'viewer')).status).toBe(403);
  expect((await post({ title: ' ' })).status).toBe(400);
  const created = (await (await post(manual)).json()) as Board;
  const id = created.id!;
  expect(created.ideas[0]).toMatchObject({ id, stage: 'idea', source: 'manual', metric: '' });
  expect(created.ideas[0]!.createdBy).toBeTruthy();
  // Outra conta não enxerga.
  expect((await put(id, { stage: 'done' }, 'other')).status).toBe(404);

  // Priorizar (ICE) move para "priorizada"; score = média.
  expect((await put(id, { ice: { impact: 11, confidence: 5, ease: 5 } })).status).toBe(400);
  const p = (await (await put(id, { ice: { impact: 9, confidence: 6, ease: 8 } })).json()) as Board;
  expect(p.ideas[0]).toMatchObject({ stage: 'prioritized', score: 7.7 });
  expect(((await (await put(id, { stage: 'idea' })).json()) as Board).ideas[0]!.stage).toBe('idea');

  // Ligar a teste existente: "em teste"; voltar às colunas anteriores exige desligar.
  expect((await put(id, { experimentId: 'exp_nao_existe' })).status).toBe(404);
  const expId = 'exp_frete';
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId: (await t.repo.listProjects(DEMO.accountId))[0]!.id,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id: expId,
      key: 'frete',
      name: 'Frete',
      status: 'running',
      variations: [
        { id: 'v0', key: 'controle', name: 'Controle', weight: 1 },
        { id: 'v1', key: 'frete', name: 'Frete', weight: 1 },
      ],
      goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
    }),
  });
  const l = (await (await put(id, { experimentId: expId })).json()) as Board;
  expect(l.ideas[0]).toMatchObject({ stage: 'testing', experimentId: expId });
  expect((await put(id, { stage: 'prioritized' })).status).toBe(409);
  const status = (s: string) =>
    t.req(`/experiments/${expId}/status`, {
      method: 'PATCH',
      as: 'owner',
      body: JSON.stringify({ status: s }),
    });

  // Teste arquivado = concluída (automático); o resultado vem do relatório e fica guardado.
  expect((await status('archived')).status).toBe(200);
  expect((await board()).ideas[0]).toMatchObject({ stage: 'done', experimentStatus: 'archived' });
  expect((await board()).ideas[0]!.result).toBeUndefined();
  const result = async () =>
    (
      (await (await t.req(`/ai/ideas/${id}/result`, { as: 'viewer' })).json()) as {
        result: { outcome: string; final: boolean } | null;
      }
    ).result;
  expect(await result()).toMatchObject({ outcome: 'inconclusive', final: true });
  expect((await board()).ideas[0]!.result).toMatchObject({ outcome: 'inconclusive' });
  // Desarquivar volta para "em teste" e o resultado guardado deixa de valer.
  expect((await status('paused')).status).toBe(200);
  expect((await board()).ideas[0]!.stage).toBe('testing');
  expect((await result())?.final).toBe(false);
  expect(await t.repo.listEntities(DEMO.accountId, 'idea-result')).toHaveLength(0);

  // Desligar devolve para "priorizada"; editar o texto.
  const u = (await (
    await put(id, { experimentId: null, title: 'Frete grátis no cabeçalho' })
  ).json()) as Board;
  expect(u.ideas[0]).toMatchObject({ stage: 'prioritized', title: 'Frete grátis no cabeçalho' });
  expect(u.ideas[0]!.experimentId).toBeUndefined();

  const acts = (await t.repo.listActivities(DEMO.accountId, {})).filter((a) => a.targetType === 'idea');
  expect(acts.map((a) => [a.action, a.detail]).reverse()).toEqual([
    ['create', null],
    ['prioritize', 'ICE 7,7'],
    ['move', 'Ideias'],
    ['link', expect.any(String)],
    ['unlink', null],
  ]);
  expect((await t.req(`/ai/ideas/${id}`, { method: 'DELETE', as: 'editor' })).status).toBe(200);
  expect((await t.repo.listActivities(DEMO.accountId, {}))[0]).toMatchObject({
    targetType: 'idea',
    action: 'delete',
    targetName: 'Frete grátis no cabeçalho',
  });

  // Dados de antes do backlog: executada com teste = em teste; sem teste = concluída.
  await t.repo.saveEntity(DEMO.accountId, {
    id: (await t.repo.listEntities(DEMO.accountId, 'ai-ideas'))[0]!.id,
    kind: 'ai-ideas',
    name: 'ideias',
    data: {
      status: 'done',
      ideas: [
        { ...idea, id: 'idea_a', createdAt: '', source: 'regras', doneAt: 'x', experimentId: expId },
        { ...idea, id: 'idea_b', createdAt: '', source: 'regras', doneAt: 'x' },
        { ...idea, id: 'idea_c', createdAt: '', source: 'regras' },
      ],
    },
  });
  expect((await board()).ideas.map((i) => i.stage)).toEqual(['testing', 'done', 'idea']);
}, 30_000);
