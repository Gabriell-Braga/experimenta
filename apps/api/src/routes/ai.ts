import { createRoute, z } from '@hono/zod-openapi';
import type Anthropic from '@anthropic-ai/sdk';
import { AI_PROMPT_MAX, AiChangeSchema, PAGE_SUMMARY_CHARS, PageSummarySchema } from '@abtest/shared';
import { AI_MODEL, claudeIdeas, compatIdeas, ruleIdeas, type CompatAi, type Idea } from '../ai';
import { claudeVariation, compatVariation } from '../ai-variation';
import { forbid, hasRole } from '../auth';
import { randomToken } from '../crypto';
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
