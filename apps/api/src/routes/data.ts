import { createRoute, z } from '@hono/zod-openapi';
import { overview } from '../analytics/overview';
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
