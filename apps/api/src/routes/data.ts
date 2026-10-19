import { createRoute, z } from '@hono/zod-openapi';
import type { Funnel, Survey } from '@abtest/shared';
import { cohortsReport } from '../analytics/cohorts';
import { engageReport } from '../analytics/engage';
import { surveyReport } from '../analytics/surveys';
import { formsReport } from '../analytics/forms';
import { funnelReport } from '../analytics/funnel';
import { journeysReport } from '../analytics/journeys';
import { deviceByVisitor } from '../analytics/report';
import { overview } from '../analytics/overview';
import { pagesReport } from '../analytics/pages';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

export const DATA_PATHS = ['/analytics/*', '/events'];

/** Coleta de dados (tarefa 9.2): visão geral do período e fluxo de eventos recentes. */
export function dataRoutes(app: Api, repo: Repo) {
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
        'Relatório de um funil salvo: visitantes por passo, conversão, tempo entre passos e para onde vão os que desistem',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({ device: z.enum(['desktop', 'tablet', 'mobile']).optional() }),
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
      return c.json(
        {
          id: f.id,
          name: f.name,
          ...funnelReport(f.data, list, devices ? (v) => devices.get(v) === q.device : undefined),
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
