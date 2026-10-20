import { createRoute, z } from '@hono/zod-openapi';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_PROMPT_MAX,
  AiChangeSchema,
  ExperimentSchema,
  PAGE_SUMMARY_CHARS,
  PageSummarySchema,
  type Experiment,
  type Goal,
  type UrlRule,
} from '@abtest/shared';
import { AI_MODEL, claudeIdeas, compatIdeas, ruleIdeas, type CompatAi, type Idea } from '../ai';
import { claudeVariation, compatVariation } from '../ai-variation';
import { forbid, hasRole } from '../auth';
import { newId, randomToken } from '../crypto';
import { errors, json, period, PeriodQuery, security, type Api } from '../http';
import type { Repo } from '../repo';
import { loadDashboard } from './data';
import { background } from './integrations';

export const AI_PATHS = ['/ai/*'];

/** Ideias guardadas na conta (uma entidade por conta) até serem executadas ou descartadas. */
const KIND = 'ai-ideas';
/** Geração "rodando" há mais que isto morreu (Worker reciclado, deploy): libera gerar de novo. */
const STALE_MS = 45_000;
/** Orçamento da geração em segundo plano, contado do início (o Worker segura ~30 s depois de responder). */
const BUDGET_MS = 24_000;

type Source = 'claude' | 'modelo' | 'regras';
interface SavedIdea extends Idea {
  id: string;
  createdAt: string;
  source: Source;
  model?: string;
  /** Marcada como executada (virou teste) pelo usuário. */
  doneAt?: string;
  /** Teste criado a partir da ideia ("Criar teste"). */
  experimentId?: string;
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
  source: z.enum(['claude', 'modelo', 'regras']),
  model: z.string().optional(),
  doneAt: z.string().optional(),
  experimentId: z.string().optional(),
});
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
    const state = e.data;
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
      const open = new Set(state.ideas.filter((i) => !i.doneAt).map((i) => norm(i.title)));
      const now = new Date().toISOString();
      const fresh = ideas
        // Sem repetir: nem as abertas, nem duas iguais no mesmo lote.
        .filter((i) => !open.has(norm(i.title)) && open.add(norm(i.title)))
        .map((i) => ({
          ...i,
          id: `idea_${randomToken(6)}`,
          createdAt: now,
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
    async (c) => c.json((await read(c.get('user').accountId)).state, 200),
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
      if (state.status === 'running') return c.json(state, 202);
      const next: IdeasState = {
        ...state,
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      };
      const saved = await write(user.accountId, id, next);
      background(c, generate(user.accountId, saved, period(c.req.valid('query'))));
      return c.json(next, 202);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/ai/ideas/{id}',
      tags: ['insights'],
      security,
      summary: 'Marca (ou desmarca) uma ideia como executada',
      request: { params: IdParam, body: json(z.object({ done: z.boolean() }), 'estado') },
      responses: { 200: json(StateOut, 'ideias'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id: ideaId } = c.req.valid('param');
      const { done } = c.req.valid('json');
      const { id, state } = await read(user.accountId);
      if (!id || !state.ideas.some((i) => i.id === ideaId))
        return c.json({ error: 'ideia não encontrada' }, 404);
      const ideas = state.ideas.map((i) => {
        if (i.id !== ideaId) return i;
        const { doneAt: _, ...rest } = i;
        return done ? { ...rest, doneAt: new Date().toISOString() } : rest;
      });
      const next = { ...state, ideas };
      await write(user.accountId, id, next);
      return c.json(next, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/ideas/{id}/experiment',
      tags: ['insights'],
      security,
      summary:
        'Cria o teste A/B da ideia (rascunho com nome, página, hipótese e meta) e marca a ideia como executada com o link; repetir devolve o mesmo teste',
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
          i.id === ideaId ? { ...i, experimentId: expId, doneAt: i.doneAt ?? new Date().toISOString() } : i,
        );
        const next = { ...now, ideas };
        await write(user.accountId, id, next);
        return c.json({ id: expId, created, goalCreated, ai, ideas: next }, 200);
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
      return c.json(next, 200);
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
      return c.json(next, 200);
    },
  );
}
