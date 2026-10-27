import { createRoute, z } from '@hono/zod-openapi';
import type { Funnel, Survey } from '@abtest/shared';
import { attribute, eventConversions, loadTouches } from '../analytics/attribution';
import { cohortsReport } from '../analytics/cohorts';
import { dayStart, ensureDays } from '../analytics/daily';
import {
  dashboardSummary,
  DASHBOARD_TYPES,
  experimentSummary,
  profilesSummary,
  type Dashboard,
} from '../analytics/dashboard';
import { findInsights } from '../analytics/insights';
import { engageReport } from '../analytics/engage';
import { surveyReport } from '../analytics/surveys';
import { formsReport } from '../analytics/forms';
import { funnelReport } from '../analytics/funnel';
import { journeysReport } from '../analytics/journeys';
import { deviceByVisitor, experimentReport } from '../analytics/report';
import { daysBetween, overview } from '../analytics/overview';
import { pagesReport } from '../analytics/pages';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

export const DATA_PATHS = ['/analytics/*', '/events'];

const DAY = 86_400_000;
/** Dias que o painel calcula do cru numa requisição (o de 7 dias inteiro: 8 + 8 do período anterior). */
const LIVE_DAYS = 16;
/** Achados: no máximo os últimos 7 dias de eventos crus (funis, formulários e relatório por dispositivo). */
const INSIGHT_DAYS = 7;
export const DASHBOARD_BLOCKS = ['summary', 'experiments', 'insights', 'profiles'] as const;
type Range = { from: Date; to: Date };

async function runningExperiments(repo: Repo, accountId: string) {
  const list = await repo.listExperiments(accountId);
  return (
    await Promise.all(
      list.filter((e) => e.status === 'running').map((e) => repo.getExperiment(accountId, e.id)),
    )
  ).flatMap((r) => (r ? [r.experiment] : []));
}

/**
 * Blocos do painel (20.1, D-096), cada um numa requisição (limite de CPU por requisição do Worker grátis):
 * resumo pelos agregados diários, testes no ar pelos eventos de cada teste, achados pelos crus dos últimos
 * 7 dias e perfis pelos `identify` do período.
 */
const blocks = {
  async summary(repo: Repo, accountId: string, range: Range) {
    const days = daysBetween(range.from, range.to);
    const first = dayStart(days[0]!);
    const prevDays = daysBetween(new Date(first - days.length * DAY), new Date(first - 1));
    const types = [...DASHBOARD_TYPES];
    const [{ stats }, cur, prev] = await Promise.all([
      ensureDays(repo, accountId, [...prevDays, ...days], LIVE_DAYS),
      repo.countDistinct(accountId, { from: new Date(first), to: range.to, types }),
      repo.countDistinct(accountId, {
        from: new Date(first - days.length * DAY),
        to: new Date(first - 1),
        types,
      }),
    ]);
    return dashboardSummary({ days, prevDays, stats, unique: { cur, prev }, to: range.to });
  },
  async experiments(repo: Repo, accountId: string, range: Range) {
    // ponytail: lê exposições e conversões do teste no período (o mesmo que o relatório); teste com tráfego
    // enorme em 90 dias ainda pode passar da CPU. Agregado por teste/variação/dia se for comum.
    const running = await runningExperiments(repo, accountId);
    const lists = await Promise.all(
      running.map((exp) =>
        repo.listEvents(accountId, { experimentId: exp.id, types: ['exposure', 'conversion'], ...range }),
      ),
    );
    return {
      experiments: running.map((exp, i) => experimentSummary(exp, experimentReport(exp, lists[i]!, range))),
    };
  },
  async insights(repo: Repo, accountId: string, range: Range) {
    // ponytail: achados só dos últimos 7 dias (precisam de eventos crus: funis, campos de formulário, por
    // dispositivo). Período maior = agregar por página/campo/passo no daily_stats.
    const r = {
      from: new Date(Math.max(range.from.getTime(), range.to.getTime() - INSIGHT_DAYS * DAY)),
      to: range.to,
    };
    const [cur, running, funnels] = await Promise.all([
      repo.listEvents(accountId, { ...r, types: [...DASHBOARD_TYPES] }),
      runningExperiments(repo, accountId),
      repo.listEntities<Funnel>(accountId, 'funnel'),
    ]);
    return {
      insightsFrom: r.from.toISOString(),
      insights: findInsights({
        cur,
        range: r,
        running,
        funnels,
        pages: pagesReport(cur),
        forms: formsReport(cur),
      }),
    };
  },
  async profiles(repo: Repo, accountId: string, range: Range) {
    // ponytail: páginas vistas só dos visitantes identificados (no D1, lotes de 80 ids por consulta).
    const identify = await repo.listEvents(accountId, { ...range, types: ['identify'] });
    const ids = [
      ...new Set(identify.filter((e) => e.type === 'identify' && e.userId).map((e) => e.visitorId)),
    ];
    const views = ids.length
      ? await repo.listEvents(accountId, { ...range, types: ['pageview'], visitorIds: ids })
      : [];
    return { profiles: profilesSummary([...identify, ...views]) };
  },
};

/** Painel inteiro de uma vez (usado pelas ideias de IA). */
export async function loadDashboard(repo: Repo, accountId: string, range: Range): Promise<Dashboard> {
  const [summary, experiments, insights, profiles] = await Promise.all([
    blocks.summary(repo, accountId, range),
    blocks.experiments(repo, accountId, range),
    blocks.insights(repo, accountId, range),
    blocks.profiles(repo, accountId, range),
  ]);
  return { ...summary, ...experiments, ...insights, ...profiles };
}

/** Coleta de dados (tarefa 9.2): visão geral do período e fluxo de eventos recentes. */
export function dataRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/dashboard',
      tags: ['relatórios'],
      security,
      summary:
        'Painel geral inteiro: insights automáticos, tráfego (com variação vs período anterior), experimentos em execução, comportamento, formulários, engajamento e perfis',
      request: { query: PeriodQuery },
      responses: { 200: json(Report, 'painel'), ...errors },
    }),
    async (c) =>
      c.json(await loadDashboard(repo, c.get('user').accountId, period(c.req.valid('query'))), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/dashboard/{block}',
      tags: ['relatórios'],
      security,
      summary:
        'Um bloco do painel (a tela carrega cada um à parte): summary (agregados diários), experiments, insights (últimos 7 dias) ou profiles',
      request: {
        query: PeriodQuery,
        params: z.object({
          block: z.enum(DASHBOARD_BLOCKS).openapi({ param: { name: 'block', in: 'path' } }),
        }),
      },
      responses: { 200: json(Report, 'bloco do painel'), ...errors },
    }),
    async (c) =>
      c.json(
        await blocks[c.req.valid('param').block](repo, c.get('user').accountId, period(c.req.valid('query'))),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/attribution',
      tags: ['relatórios'],
      security,
      summary:
        'Receita por canal: conversões (eventos com valor, ou um evento pelo nome) e receita por canal, origem e campanha, no primeiro toque e no último toque não direto (janela de 30 dias)',
      request: { query: PeriodQuery.extend({ event: z.string().max(100).optional() }) },
      responses: { 200: json(Report, 'atribuição'), ...errors },
    }),
    async (c) => {
      // Fora do /analytics/dashboard de propósito (CPU do Worker): o cartão do painel chama à parte.
      const accountId = c.get('user').accountId;
      const q = c.req.valid('query');
      const range = period(q);
      const conv = eventConversions(
        await repo.listEvents(accountId, { ...range, types: ['event'] }),
        q.event,
      );
      const touches = await loadTouches(repo, accountId, conv.list, range);
      return c.json(
        {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          event: q.event ?? null,
          events: conv.events,
          ...attribute(conv.list, touches),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/overview',
      tags: ['dados'],
      security,
      summary: 'Totais, série diária, páginas, eventos, dispositivos e referências do período',
      request: { query: PeriodQuery },
      responses: { 200: json(Report, 'visão geral'), ...errors },
    }),
    async (c) => {
      const { from, to } = period(c.req.valid('query'));
      const list = await repo.listEvents(c.get('user').accountId, {
        from,
        to,
        types: ['pageview', 'event', 'conversion', 'exposure', 'identify'],
      });
      return c.json(overview(list, from, to), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/pages',
      tags: ['insights'],
      security,
      summary:
        'Páginas com páginas vistas, visitantes, cliques, rage/dead clicks e scroll médio (mapas de calor)',
      request: { query: PeriodQuery.extend({ device: z.enum(['desktop', 'tablet', 'mobile']).optional() }) },
      responses: { 200: json(Report, 'páginas, da mais vista à menos vista'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const list = await repo.listEvents(c.get('user').accountId, {
        ...period(q),
        types: ['pageview', 'click', 'frustration', 'scroll'],
      });
      return c.json(pagesReport(list, q.device), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/forms',
      tags: ['insights'],
      security,
      summary:
        'Form analytics: chegaram → interagiram → enviaram por formulário e, por campo, tempo, hesitação, re-preenchimento, ignorados e abandono',
      request: { query: PeriodQuery.extend({ device: z.enum(['desktop', 'tablet', 'mobile']).optional() }) },
      responses: { 200: json(Report, 'formulários, do mais visto ao menos visto'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const list = await repo.listEvents(c.get('user').accountId, { ...period(q), types: ['form'] });
      return c.json(formsReport(list, { device: q.device }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/funnel/{id}',
      tags: ['insights'],
      security,
      summary:
        'Relatório de um funil salvo: visitantes por passo, conversão, tempo entre passos e para onde vão os que desistem; `event` filtra quem fez o evento no período e `eventNames` lista os eventos vistos',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
          event: z.string().max(100).optional(),
        }),
      },
      responses: { 200: json(Report, 'funil'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const f = await repo.getEntity<Funnel>(accountId, 'funnel', c.req.valid('param').id);
      if (!f) return c.json({ error: 'funil não encontrado' }, 404);
      const q = c.req.valid('query');
      const list = await repo.listEvents(accountId, { ...period(q), types: ['pageview', 'event'] });
      const devices = q.device ? deviceByVisitor(list) : null;
      const names = new Set<string>();
      const did = new Set<string>();
      for (const e of list)
        if (e.type === 'event') {
          names.add(e.name);
          if (e.name === q.event) did.add(e.visitorId);
        }
      const keep =
        devices || q.event
          ? (v: string) => (!devices || devices.get(v) === q.device) && (!q.event || did.has(v))
          : undefined;
      return c.json(
        {
          id: f.id,
          name: f.name,
          ...funnelReport(f.data, list, keep),
          eventNames: [...names].sort(),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/journeys',
      tags: ['insights'],
      security,
      summary:
        'Jornadas: entradas, saídas, caminhos mais comuns e, com `page`, de onde vêm e para onde vão os visitantes',
      request: {
        query: PeriodQuery.extend({
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
          page: z.string().optional(),
          depth: z.coerce.number().int().min(2).max(8).default(4),
        }),
      },
      responses: { 200: json(Report, 'jornadas'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const list = await repo.listEvents(c.get('user').accountId, { ...period(q), types: ['pageview'] });
      return c.json(journeysReport(list, { focus: q.page, depth: q.depth, device: q.device }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/cohorts',
      tags: ['insights'],
      security,
      summary:
        'Coortes por data da 1ª visita: retenção (voltou ao site) ou conversão acumulada (evento ou qualquer meta) por período',
      request: {
        query: PeriodQuery.extend({
          days: z.coerce.number().int().min(1).max(365).default(56),
          unit: z.enum(['day', 'week']).default('week'),
          metric: z.enum(['retention', 'event']).default('retention'),
          event: z.string().optional(),
        }),
      },
      responses: { 200: json(Report, 'coortes'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const list = await repo.listEvents(c.get('user').accountId, {
        ...period(q),
        types: ['pageview', 'event', 'conversion'],
      });
      return c.json(cohortsReport(list, { unit: q.unit, metric: q.metric, event: q.event }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/engage',
      tags: ['engajamento'],
      security,
      summary:
        'Pop-ups e pesquisas: exibições, visitantes, cliques (CTR), fechamentos e respostas por campanha',
      request: { query: PeriodQuery },
      responses: { 200: json(Report, 'por campanha'), ...errors },
    }),
    async (c) => {
      const list = await repo.listEvents(c.get('user').accountId, {
        ...period(c.req.valid('query')),
        types: ['engage'],
      });
      return c.json(engageReport(list), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/analytics/survey/{id}',
      tags: ['engajamento'],
      security,
      summary:
        'Respostas de uma pesquisa: NPS, CSAT, CES, notas, escolhas, textos (com palavras frequentes) e taxa de resposta',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery,
      },
      responses: { 200: json(Report, 'relatório'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const s = await repo.getEntity<Survey>(accountId, 'survey', c.req.valid('param').id);
      if (!s) return c.json({ error: 'pesquisa não encontrada' }, 404);
      const list = await repo.listEvents(accountId, {
        ...period(c.req.valid('query')),
        types: ['engage', 'survey'],
      });
      return c.json({ id: s.id, name: s.name, ...surveyReport(s.data, s.id, list) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/events',
      tags: ['dados'],
      security,
      summary: 'Eventos mais recentes (payload cru), opcionalmente de um tipo, visitante ou sessão',
      request: {
        query: z.object({
          type: z.string().optional(),
          visitorId: z.string().optional(),
          sessionId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
      responses: { 200: json(Report, 'eventos, do mais recente ao mais antigo'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      return c.json(
        await repo.listEvents(c.get('user').accountId, {
          types: q.type ? [q.type] : undefined,
          visitorIds: q.visitorId ? [q.visitorId] : undefined,
          sessionId: q.sessionId,
          limit: q.limit,
          order: 'desc',
        }),
        200,
      );
    },
  );
}
