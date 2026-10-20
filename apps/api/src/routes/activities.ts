import { createRoute, z } from '@hono/zod-openapi';
import { errors, json, security, type Api } from '../http';
import type { Repo } from '../repo';

export const ACTIVITY_PATHS = ['/activities'];

const ActivityOut = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    userName: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string().nullable(),
    targetName: z.string(),
    detail: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Activity');

/** Histórico de atividades (fase 16.3). Gravado pelo middleware de audit.ts; aqui só a leitura (qualquer papel). */
export function activityRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/activities',
      tags: ['conta'],
      security,
      summary: 'Quem fez o quê e quando (mais recentes primeiro); `next` pagina para trás',
      request: {
        query: z.object({
          userId: z.string().max(100).optional(),
          type: z.string().max(40).optional(),
          targetId: z.string().max(100).optional(),
          before: z.string().datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
      responses: {
        200: json(z.object({ items: z.array(ActivityOut), next: z.string().nullable() }), 'atividades'),
        ...errors,
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const items = await repo.listActivities(c.get('user').accountId, {
        userId: q.userId,
        targetType: q.type,
        targetId: q.targetId,
        before: q.before ? new Date(q.before) : undefined,
        limit: q.limit,
      });
      const next = items.length === q.limit ? items[items.length - 1]!.createdAt : null;
      return c.json({ items, next }, 200);
    },
  );
}
