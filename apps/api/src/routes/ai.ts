import { createRoute, z } from '@hono/zod-openapi';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_PROMPT_MAX,
  AiChangeSchema,
  ExperimentSchema,
  IDEA_STAGES,
  iceScore,
  PAGE_SUMMARY_CHARS,
  PageSummarySchema,
  type Experiment,
  type Goal,
  type Ice,
  type IdeaStage,
  type UrlRule,
} from '@abtest/shared';
import { AI_MODEL, claudeIdeas, compatIdeas, ruleIdeas, type CompatAi, type Idea } from '../ai';
import { claudeVariation, compatVariation } from '../ai-variation';
import { forbid, hasRole } from '../auth';
import { newId, randomToken } from '../crypto';
import { errors, json, period, PeriodQuery, security, type Api } from '../http';
import type { Repo } from '../repo';
import type { ExperimentReport } from '../analytics/report';
import { loadDashboard } from './data';
import { background } from './integrations';
import { loadReport } from './report';

export const AI_PATHS = ['/ai/*'];

/** Ideias guardadas na conta (uma entidade por conta) até serem executadas ou descartadas. */
const KIND = 'ai-ideas';
/** Resultado do teste ligado à ideia, guardado à parte (uma entidade por ideia, `name` = id da ideia). */
const RESULT_KIND = 'idea-result';
/** Geração "rodando" há mais que isto morreu (Worker reciclado, deploy): libera gerar de novo. */
const STALE_MS = 45_000;
/** Orçamento da geração em segundo plano, contado do início (o Worker segura ~30 s depois de responder). */
const BUDGET_MS = 24_000;

type Source = 'claude' | 'modelo' | 'regras';
interface SavedIdea extends Omit<Idea, 'impact' | 'effort'> {
  /** Vazio nas ideias manuais (a prioridade delas é o ICE). */
  impact: Idea['impact'] | '';
  effort: Idea['effort'] | '';
  id: string;
  createdAt: string;
  /** `manual` = escrita por alguém da equipe (backlog, 18.3). */
  source: Source | 'manual';
  model?: string;
  /** Quem escreveu a ideia manual. */
  createdBy?: string;
  /** Coluna do backlog (ausente nos dados de antes da 18.3: ver `migrate`). */
  stage?: IdeaStage;
  stageAt?: string;
  ice?: Ice;
  /** Legado (antes da 18.3): marcada como executada. */
  doneAt?: string;
  /** Teste ligado: criado pela ideia ("Criar teste") ou escolhido no quadro. */
  experimentId?: string;
}

/** Resultado do teste ligado, resumido do relatório (meta primária). */
export interface IdeaResult {
  outcome: 'winner' | 'loser' | 'inconclusive';
  /** Melhoria relativa da variação destacada vs controle (0.12 = +12%). */
  lift: number | null;
  variation?: string;
  goal: string;
  visitors: number;
  at: string;
  /** Experimento arquivado: resultado definitivo (guardado). */
  final: boolean;
}

/** Ideias salvas antes do backlog: executada com teste = "em teste" (o status do teste decide), sem = "concluída". */
export const migrate = (i: SavedIdea): SavedIdea =>
  i.stage ? i : { ...i, stage: i.doneAt ? (i.experimentId ? 'testing' : 'done') : 'idea' };

/**
 * Coluna mostrada: com teste ligado (que ainda existe), o status dele manda: arquivado = concluída, qualquer
 * outro = em teste; concluída à mão continua concluída. Sem teste, a coluna guardada.
 */
export function effectiveStage(stage: IdeaStage, expStatus?: string): IdeaStage {
  if (!expStatus) return stage;
  return stage === 'done' || expStatus === 'archived' ? 'done' : 'testing';
}

/** Resultado a partir do relatório: vencedora (a de maior lift), todas perdedoras, ou inconclusivo. */
export function ideaResult(
  exp: Experiment,
  report: Pick<ExperimentReport, 'goals'>,
  now = new Date(),
): IdeaResult | null {
  const g = report.goals[0];
  const arms = g?.arms.filter((a) => a.verdict !== 'baseline') ?? [];
  if (!g || !arms.length) return null;
  const best = (xs: typeof arms) =>
    xs.reduce((a, b) => ((b.lift ?? -Infinity) > (a.lift ?? -Infinity) ? b : a));
  const winners = arms.filter((a) => a.verdict === 'winner');
  const pick = best(winners.length ? winners : arms);
  return {
    outcome: winners.length ? 'winner' : arms.every((a) => a.verdict === 'loser') ? 'loser' : 'inconclusive',
    lift: pick.lift,
    variation: exp.variations.find((v) => v.id === pick.variationId)?.name,
    goal: g.goalKey,
    visitors: g.arms.reduce((n, a) => n + a.visitors, 0),
    at: now.toISOString(),
    final: exp.status === 'archived',
  };
}
interface IdeasState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: string;
  finishedAt?: string;
  source?: Source;
  model?: string;
  error?: string;
  notice?: string;
  ideas: SavedIdea[];
}

const IceIn = z.object({
  impact: z.number().int().min(1).max(10),
  confidence: z.number().int().min(1).max(10),
  ease: z.number().int().min(1).max(10),
});
const ResultOut = z.object({
  outcome: z.enum(['winner', 'loser', 'inconclusive']),
  lift: z.number().nullable(),
  variation: z.string().optional(),
  goal: z.string(),
  visitors: z.number(),
  at: z.string(),
  final: z.boolean(),
});
const IdeaOut = z.object({
  id: z.string(),
  title: z.string(),
  hypothesis: z.string(),
  page: z.string(),
  change: z.string(),
  metric: z.string(),
  impact: z.string(),
  effort: z.string(),
  basedOn: z.string(),
  createdAt: z.string(),
  source: z.enum(['claude', 'modelo', 'regras', 'manual']),
  model: z.string().optional(),
  createdBy: z.string().optional(),
  /** Coluna mostrada (com teste ligado, segue o status dele). */
  stage: z.enum(IDEA_STAGES),
  stageAt: z.string().optional(),
  ice: IceIn.optional(),
  /** ICE = média de impacto, confiança e facilidade (1–10). */
  score: z.number().optional(),
  doneAt: z.string().optional(),
  experimentId: z.string().optional(),
  experimentName: z.string().optional(),
  /** Status do teste ligado; `deleted` = o teste foi excluído. */
  experimentStatus: z.string().optional(),
  /** Resultado definitivo guardado (teste arquivado). */
  result: ResultOut.optional(),
});
/** Texto da ideia escrito pela equipe. */
const IdeaText = {
  title: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().max(2000),
  change: z.string().trim().max(2000),
  page: z.string().trim().max(500),
  metric: z.string().trim().max(200),
};
const StateOut = z
  .object({
    status: z.enum(['idle', 'running', 'done', 'error']),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    source: z.enum(['claude', 'modelo', 'regras']).optional(),
    model: z.string().optional(),
    error: z.string().optional(),
    notice: z.string().optional(),
    ideas: z.array(IdeaOut),
  })
  .openapi('IdeasState');
const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

const norm = (s: string) => s.trim().toLowerCase();

/** Minúsculas sem acento, só letras e números separados por espaço. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** Palavras que não identificam uma meta ("conversão da página" não casa com uma meta "da"). */
const STOP = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'no',
  'na',
  'em',
  'e',
  'o',
  'a',
  'os',
  'as',
  'por',
  'para',
]);
const words = (s: string) =>
  fold(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
const slug = (s: string) => words(s).join('-').slice(0, 40).replace(/-$/, '');

/**
 * Meta do teste a partir do texto da ideia ("envio do formulário"): reaproveita a meta já usada em outro teste
 * da conta cujo nome (chave, ou evento customizado) está todo no texto, a mais específica; senão cria uma meta
 * de evento customizado com o nome do texto (o site precisa disparar o evento; ajustável em Configurações).
 */
export function ideaGoal(metric: string, existing: Goal[]): { goal: Goal; created: boolean } {
  // Singular simples ("cliques" casa com "clique-cta").
  const stem = (w: string) => (w.length > 3 ? w.replace(/s$/, '') : w);
  const text = new Set(words(metric).map(stem));
  let best: Goal | undefined;
  let score = 0;
  for (const g of existing)
    for (const name of [g.key, g.type === 'custom' ? g.event : '']) {
      const ws = words(name).map(stem);
      if (ws.length > score && ws.every((w) => text.has(w))) [best, score] = [g, ws.length];
    }
  if (best) return { goal: { ...best, id: newId('goal') }, created: false };
  const key = slug(metric) || 'conversao';
  return { goal: { id: newId('goal'), key, type: 'custom', event: key }, created: true };
}

/**
 * Página do teste a partir da ideia: caminho ("/carrinho", "/produto/* ...") ou URL do próprio site viram a
 * página aberta no editor e a regra de URL (com `*`, "contém" o prefixo); texto solto ("todo o site",
 * "formulário") abre a home do projeto e vale em todo o site (o usuário ajusta a segmentação).
 */
export function ideaPage(page: string, siteUrl: string): { url: string; rule?: UrlRule } {
  const site = new URL(siteUrl);
  const token = page.trim().split(/\s/)[0] ?? '';
  const star = token.indexOf('*');
  try {
    const raw = star < 0 ? token : token.slice(0, star);
    const u = raw.startsWith('/') ? new URL(raw, site) : new URL(raw);
    if (u.origin === site.origin)
      return {
        url: u.href,
        rule: { match: star < 0 ? 'exact' : 'contains', value: u.href, exclude: false },
      };
  } catch {
    // Não é caminho nem URL: cai na home.
  }
  return { url: site.href };
}

/** Teste A/B em rascunho a partir da ideia (id e chave estáveis por ideia: clique duplo não cria dois). */
export function ideaExperiment(
  idea: Pick<SavedIdea, 'id' | 'title' | 'hypothesis' | 'page' | 'metric'>,
  siteUrl: string,
  others: Experiment[],
): { experiment: Experiment; editorUrl: string; goalCreated: boolean } {
  const id = `exp_${idea.id}`;
  const taken = new Set(others.filter((e) => e.id !== id).map((e) => e.key));
  let key = `${slug(idea.title) || 'teste'}-${idea.id
    .replace(/^idea_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')}`;
  if (taken.has(key)) key = `${key}-${Math.random().toString(36).slice(2, 6)}`;
  const { url, rule } = ideaPage(idea.page, siteUrl);
  const { goal, created } = ideaGoal(
    idea.metric,
    others.flatMap((e) => e.goals),
  );
  const v = (k: string, name: string) => ({ id: newId('var'), key: k, name, weight: 50 });
  const experiment = ExperimentSchema.parse({
    id,
    key,
    name: idea.title.trim().slice(0, 200) || 'Teste da ideia',
    hypothesis: idea.hypothesis.trim().slice(0, 2000) || undefined,
    segmentation: { urls: rule ? [rule] : [] },
    variations: [v('controle', 'Controle'), v('variacao-1', 'Variação 1')],
    goals: [goal],
  });
  return { experiment, editorUrl: url, goalCreated: created };
}

const VariationOut = z
  .object({
    changes: z.array(AiChangeSchema),
    /** Alterações da resposta descartadas na validação (ref inexistente, tipo/valor não permitido). */
    skipped: z.number(),
    message: z.string(),
    source: z.enum(['claude', 'modelo']),
    model: z.string(),
  })
  .openapi('AiVariation');
const ErrorOut = z.object({ error: z.string() });

/** Otimização por IA: ideias de teste a partir do painel, geradas em segundo plano e guardadas na conta. */
export function aiRoutes(app: Api, repo: Repo, client?: Anthropic, compat?: CompatAi) {
  async function read(accountId: string): Promise<{ id?: string; state: IdeasState }> {
    const [e] = await repo.listEntities<IdeasState>(accountId, KIND);
    if (!e) return { state: { status: 'idle', ideas: [] } };
    const state = { ...e.data, ideas: e.data.ideas.map(migrate) };
    if (state.status === 'running' && Date.now() - Date.parse(state.startedAt ?? '') > STALE_MS)
      return {
        id: e.id,
        state: { ...state, status: 'error', error: 'a geração não terminou; tente de novo' },
      };
    return { id: e.id, state };
  }
  // ponytail: ler-modificar-gravar sem trava; duas gerações simultâneas da mesma conta podem perder uma.
  const write = (accountId: string, id: string | undefined, state: IdeasState) =>
    repo.saveEntity(accountId, { id, kind: KIND, name: 'ideias', data: state });

  /**
   * Quadro para a resposta: coluna efetiva (status do teste ligado), nome do teste, score ICE e resultado
   * guardado. Duas consultas leves (lista de testes e resultados guardados); nenhum relatório calculado aqui.
   */
  async function view(accountId: string, state: IdeasState) {
    const linked = state.ideas.some((i) => i.experimentId);
    const [exps, results] = linked
      ? await Promise.all([
          repo.listExperiments(accountId),
          repo.listEntities<IdeaResult>(accountId, RESULT_KIND),
        ])
      : [[], []];
    const byId = new Map(exps.map((e) => [e.id, e]));
    const saved = new Map(results.map((r) => [r.name, r.data]));
    return {
      ...state,
      ideas: state.ideas.map((i) => {
        const exp = i.experimentId ? byId.get(i.experimentId) : undefined;
        const result = saved.get(i.id);
        return {
          ...i,
          stage: effectiveStage(i.stage ?? 'idea', exp?.status),
          ...(i.ice ? { score: iceScore(i.ice) } : {}),
          ...(exp ? { experimentName: exp.name, experimentStatus: exp.status } : {}),
          ...(i.experimentId && !exp ? { experimentStatus: 'deleted' } : {}),
          ...(result ? { result } : {}),
        };
      }),
    };
  }
  async function dropResult(accountId: string, ideaId?: string) {
    for (const r of await repo.listEntities(accountId, RESULT_KIND))
      if (!ideaId || r.name === ideaId) await repo.deleteEntity(accountId, RESULT_KIND, r.id);
  }

  /** Gera, junta às ideias guardadas (sem repetir título ainda aberto) e grava o resultado. */
  async function generate(accountId: string, id: string, days: ReturnType<typeof period>) {
    let ideas: Idea[] = [];
    let source: Source = 'regras';
    let model: string | undefined;
    /** Por que caiu nas regras (mostrado na tela). */
    let notice: string | undefined;
    const t0 = Date.now();
    try {
      const d = await loadDashboard(repo, accountId, days);
      if (client)
        try {
          ideas = await claudeIdeas(client, d);
          source = 'claude';
          model = AI_MODEL;
        } catch (e) {
          console.error('[api] ideias com Claude falharam; usando regras', e);
          notice = `Claude indisponível (${(e as Error).message.slice(0, 120)}); ideias por regras.`;
        }
      else if (compat)
        try {
          ({ ideas, model } = await compatIdeas(compat, d, fetch, BUDGET_MS - (Date.now() - t0)));
          source = 'modelo';
        } catch (e) {
          console.error(`[api] ideias com ${compat.model} falharam; usando regras`, e);
          notice = `Modelo de IA indisponível agora (${(e as Error).message.slice(0, 120)}); ideias por regras.`;
        }
      if (source === 'regras') ideas = ruleIdeas(d.insights);
      const { state } = await read(accountId);
      const open = new Set(state.ideas.filter((i) => i.stage !== 'done').map((i) => norm(i.title)));
      const now = new Date().toISOString();
      const fresh = ideas
        // Sem repetir: nem as abertas, nem duas iguais no mesmo lote.
        .filter((i) => !open.has(norm(i.title)) && open.add(norm(i.title)))
        .map((i) => ({
          ...i,
          id: `idea_${randomToken(6)}`,
          createdAt: now,
          stage: 'idea' as const,
          source,
          ...(model ? { model } : {}),
        }));
      await write(accountId, id, {
        ...state,
        status: 'done',
        finishedAt: now,
        source,
        model,
        error: undefined,
        notice,
        ideas: [...fresh, ...state.ideas],
      });
    } catch (e) {
      console.error('[api] geração de ideias falhou', e);
      const { state } = await read(accountId);
      await write(accountId, id, { ...state, status: 'error', error: (e as Error).message });
    }
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/variation',
      tags: ['insights'],
      security,
      summary:
        'Variação por texto: pedido + resumo da página (do agent) → alterações declarativas (texto, estilo, atributo, esconder, imagem, mover) que citam elementos pelo ref do resumo. Nunca HTML nem JS.',
      request: {
        body: json(
          z.object({ prompt: z.string().trim().min(1).max(AI_PROMPT_MAX), page: PageSummarySchema }),
          'pedido e resumo da página',
        ),
      },
      responses: {
        200: json(VariationOut, 'alterações propostas (ainda não aplicadas)'),
        413: json(ErrorOut, 'resumo da página grande demais'),
        502: json(ErrorOut, 'provedor de IA falhou'),
        409: json(ErrorOut, 'IA não configurada nesta instalação'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { prompt, page } = c.req.valid('json');
      if (!client && !compat)
        return c.json(
          {
            error:
              'IA não configurada nesta instalação: defina ANTHROPIC_API_KEY (Claude) ou AI_BASE_URL e AI_MODEL (modelo compatível com OpenAI) na API.',
          },
          409,
        );
      if (JSON.stringify(page.elements).length > PAGE_SUMMARY_CHARS)
        return c.json({ error: 'A página é grande demais para a IA.' }, 413);
      try {
        const r = client
          ? { ...(await claudeVariation(client, prompt, page)), source: 'claude' as const }
          : { ...(await compatVariation(compat!, prompt, page)), source: 'modelo' as const };
        return c.json(r, 200);
      } catch (e) {
        console.error('[api] variação por IA falhou', e);
        return c.json(
          { error: `A IA não respondeu agora (${(e as Error).message.slice(0, 120)}). Tente de novo.` },
          502,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/ideas',
      tags: ['insights'],
      security,
      summary: 'Ideias guardadas da conta e o estado da última geração',
      responses: { 200: json(StateOut, 'ideias'), ...errors },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      return c.json(await view(accountId, (await read(accountId)).state), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/ideas',
      tags: ['insights'],
      security,
      summary:
        'Gera novas ideias em segundo plano a partir do painel do período (Claude, modelo grátis compatível com OpenAI ou regras) e junta às guardadas; acompanhe por GET',
      request: { query: PeriodQuery },
      responses: { 202: json(StateOut, 'geração iniciada (ou já em andamento)'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, state } = await read(user.accountId);
      if (state.status === 'running') return c.json(await view(user.accountId, state), 202);
      const next: IdeasState = {
        ...state,
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      };
      const saved = await write(user.accountId, id, next);
      background(c, generate(user.accountId, saved, period(c.req.valid('query'))));
      return c.json(await view(user.accountId, next), 202);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/ideas/manual',
      tags: ['insights'],
      security,
      summary:
        'Cria uma ideia escrita pela equipe no backlog (coluna "ideia", ou "priorizada" se já vier com ICE)',
      request: {
        body: json(
          z.object({
            ...IdeaText,
            hypothesis: IdeaText.hypothesis.default(''),
            change: IdeaText.change.default(''),
            page: IdeaText.page.default(''),
            metric: IdeaText.metric.default(''),
            ice: IceIn.optional(),
          }),
          'ideia',
        ),
      },
      responses: { 200: json(StateOut.extend({ id: z.string() }), 'ideias e o id da nova'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { ice, ...text } = c.req.valid('json');
      const { id, state } = await read(user.accountId);
      const now = new Date().toISOString();
      const idea: SavedIdea = {
        ...text,
        impact: '',
        effort: '',
        basedOn: '',
        id: `idea_${randomToken(6)}`,
        createdAt: now,
        source: 'manual',
        createdBy: user.name,
        stage: ice ? 'prioritized' : 'idea',
        stageAt: now,
        ...(ice ? { ice } : {}),
      };
      const next = { ...state, ideas: [idea, ...state.ideas] };
      await write(user.accountId, id, next);
      return c.json({ ...(await view(user.accountId, next)), id: idea.id }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/ai/ideas/{id}',
      tags: ['insights'],
      security,
      summary:
        'Edita a ideia do backlog: texto, pontuação ICE (priorizar move "ideia" para "priorizada"), coluna e teste ligado. Ideia com teste ligado só fica em "em teste" ou "concluída". `done` é o formato antigo (concluída/reaberta).',
      request: {
        params: IdParam,
        body: json(
          z
            .object({
              ...IdeaText,
              stage: z.enum(IDEA_STAGES),
              ice: IceIn.nullable(),
              experimentId: z.string().min(1).max(100).nullable(),
              done: z.boolean(),
            })
            .partial(),
          'alterações',
        ),
      },
      responses: {
        200: json(StateOut, 'ideias'),
        409: json(ErrorOut, 'movimento não permitido com teste ligado'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id: ideaId } = c.req.valid('param');
      const { done, stage, ice, experimentId, ...text } = c.req.valid('json');
      const { id, state } = await read(user.accountId);
      const cur = state.ideas.find((i) => i.id === ideaId);
      if (!id || !cur) return c.json({ error: 'ideia não encontrada' }, 404);
      const i: SavedIdea = { ...cur, ...text };
      if (experimentId === null) {
        delete i.experimentId;
        if (i.stage === 'testing') i.stage = 'prioritized';
      } else if (experimentId) {
        if (!(await repo.getExperiment(user.accountId, experimentId)))
          return c.json({ error: 'teste não encontrado' }, 404);
        i.experimentId = experimentId;
        if (i.stage !== 'done') i.stage = 'testing';
      }
      if (ice === null) delete i.ice;
      else if (ice) {
        i.ice = ice;
        // Priorizar é o que tira a ideia da 1ª coluna.
        if (i.stage === 'idea' && !stage) i.stage = 'prioritized';
      }
      const linked =
        !!i.experimentId &&
        (i.experimentId === experimentId || !!(await repo.getExperiment(user.accountId, i.experimentId)));
      const to = stage ?? (done === undefined ? undefined : done ? 'done' : linked ? 'testing' : 'idea');
      if (to) {
        if (linked && (to === 'idea' || to === 'prioritized'))
          return c.json(
            { error: 'a ideia está ligada a um teste: desligue o teste para voltar às colunas anteriores' },
            409,
          );
        i.stage = to;
      }
      if (i.stage !== cur.stage) i.stageAt = new Date().toISOString();
      if (i.stage !== 'done') delete i.doneAt;
      const next = { ...state, ideas: state.ideas.map((x) => (x.id === ideaId ? i : x)) };
      await write(user.accountId, id, next);
      return c.json(await view(user.accountId, next), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ai/ideas/{id}/result',
      tags: ['insights'],
      security,
      summary:
        'Resultado do teste ligado à ideia (vencedora, perdedora ou inconclusivo, com lift), resumido do relatório da meta primária; calculado sob demanda e guardado quando o teste está arquivado',
      request: { params: IdParam },
      responses: { 200: json(z.object({ result: ResultOut.nullable() }), 'resultado'), ...errors },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      const { id: ideaId } = c.req.valid('param');
      const idea = (await read(accountId)).state.ideas.find((i) => i.id === ideaId);
      if (!idea) return c.json({ error: 'ideia não encontrada' }, 404);
      const rec = idea.experimentId ? await repo.getExperiment(accountId, idea.experimentId) : null;
      if (!rec) return c.json({ result: null }, 200);
      const cached = (await repo.listEntities<IdeaResult>(accountId, RESULT_KIND)).find(
        (r) => r.name === ideaId,
      );
      if (cached?.data.final && rec.experiment.status === 'archived')
        return c.json({ result: cached.data }, 200);
      // Um relatório só, o deste teste (o quadro nunca calcula relatórios: CPU do Worker grátis).
      const report = await loadReport(repo, accountId, rec.experiment, { days: 365 });
      const result = ideaResult(rec.experiment, report);
      if (result?.final)
        await repo.saveEntity(accountId, { id: cached?.id, kind: RESULT_KIND, name: ideaId, data: result });
      else if (cached) await repo.deleteEntity(accountId, RESULT_KIND, cached.id);
      return c.json({ result }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/ideas/{id}/experiment',
      tags: ['insights'],
      security,
      summary:
        'Cria o teste A/B da ideia (rascunho com nome, página, hipótese e meta) e liga a ideia ao teste (coluna "em teste"); repetir devolve o mesmo teste',
      request: { params: IdParam },
      responses: {
        200: json(
          z.object({
            id: z.string(),
            /** false = o teste já existia (clique duplo, outra aba). */
            created: z.boolean(),
            /** A meta não casou com nenhuma da conta e foi criada como evento customizado. */
            goalCreated: z.boolean(),
            /** Há provedor de IA para gerar as alterações sugeridas no editor. */
            ai: z.boolean(),
            ideas: StateOut,
          }),
          'teste da ideia',
        ),
        409: json(ErrorOut, 'conta sem projeto'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id: ideaId } = c.req.valid('param');
      const ai = !!(client || compat);
      const { id, state } = await read(user.accountId);
      const idea = state.ideas.find((i) => i.id === ideaId);
      if (!id || !idea) return c.json({ error: 'ideia não encontrada' }, 404);
      const link = async (expId: string, created: boolean, goalCreated: boolean) => {
        // Relê: criar levou algumas consultas e outra escrita das ideias pode ter acontecido no meio.
        const { state: now } = await read(user.accountId);
        const ideas = now.ideas.map((i) =>
          i.id === ideaId
            ? {
                ...i,
                experimentId: expId,
                ...(i.stage === 'testing'
                  ? {}
                  : { stage: 'testing' as const, stageAt: new Date().toISOString() }),
              }
            : i,
        );
        const next = { ...now, ideas };
        await write(user.accountId, id, next);
        return c.json({ id: expId, created, goalCreated, ai, ideas: await view(user.accountId, next) }, 200);
      };
      // Já criado (mesmo que o vínculo tenha se perdido numa escrita concorrente): devolve o mesmo teste.
      for (const expId of new Set([idea.experimentId, `exp_${idea.id}`]))
        if (expId && (await repo.getExperiment(user.accountId, expId))) return link(expId, false, false);
      const [project] = await repo.listProjects(user.accountId);
      if (!project) return c.json({ error: 'crie um projeto (site) antes de criar testes' }, 409);
      const others = await repo.loadAllExperiments(user.accountId);
      const { experiment, editorUrl, goalCreated } = ideaExperiment(idea, project.siteUrl, others);
      await repo.saveExperiment(user.accountId, {
        projectId: project.id,
        editorUrl,
        experiment,
        userId: user.id,
      });
      return link(experiment.id, true, goalCreated);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/ai/ideas/{id}',
      tags: ['insights'],
      security,
      summary: 'Descarta uma ideia',
      request: { params: IdParam },
      responses: { 200: json(StateOut, 'ideias'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id: ideaId } = c.req.valid('param');
      const { id, state } = await read(user.accountId);
      if (!id || !state.ideas.some((i) => i.id === ideaId))
        return c.json({ error: 'ideia não encontrada' }, 404);
      const next = { ...state, ideas: state.ideas.filter((i) => i.id !== ideaId) };
      await write(user.accountId, id, next);
      await dropResult(user.accountId, ideaId);
      return c.json(await view(user.accountId, next), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/ai/ideas',
      tags: ['insights'],
      security,
      summary: 'Limpa todas as ideias guardadas',
      responses: { 200: json(StateOut, 'ideias'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, state } = await read(user.accountId);
      // Geração em andamento continua; só as ideias somem.
      const next: IdeasState = {
        status: state.status === 'running' ? 'running' : 'idle',
        startedAt: state.startedAt,
        ideas: [],
      };
      if (id) await write(user.accountId, id, next);
      await dropResult(user.accountId);
      return c.json(await view(user.accountId, next), 200);
    },
  );
}
