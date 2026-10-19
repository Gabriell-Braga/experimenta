import { createRoute, z } from '@hono/zod-openapi';
import { deviceByVisitor, experimentReport } from '../analytics/report';
import { forbid, hasRole } from '../auth';
import { rebalance } from '../bandit';
import type { AppDeps } from '../app';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

/** Relatório de experimento (tarefa 9.4). Caminho já coberto por `/experiments/*` (privado). */
export function reportRoutes(app: Api, repo: Repo, publish?: AppDeps['publish']) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/report',
      tags: ['relatórios'],
      security,
      summary:
        'Visitantes, conversões e receita por variação e meta, com estatística bayesiana e frequentista, série diária acumulada, SRM e duração estimada',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({
          days: z.coerce.number().int().min(1).max(365).default(90),
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
        }),
      },
      responses: { 200: json(Report, 'relatório'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const rec = await repo.getExperiment(accountId, c.req.valid('param').id);
      if (!rec) return c.json({ error: 'experimento não encontrado' }, 404);
      const q = c.req.valid('query');
      const range = period(q);
      const events = await repo.listEvents(accountId, {
        experimentId: rec.experiment.id,
        types: ['exposure', 'conversion'],
        ...range,
      });
      let filter: ((v: string) => boolean) | undefined;
      if (q.device) {
        const ids = [...new Set(events.filter((e) => e.type === 'exposure').map((e) => e.visitorId))];
        const devices = deviceByVisitor(
          await repo.listEvents(accountId, { types: ['pageview'], visitorIds: ids, ...range }),
        );
        filter = (v) => devices.get(v) === q.device;
      }
      return c.json(experimentReport(rec.experiment, events, range, filter), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments/{id}/rebalance',
      tags: ['experiments'],
      security,
      summary: 'Bandit: recalcula os pesos agora (Thompson sampling na meta primária) e republica se mudaram',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 200: json(Report, '{ changed, weights }'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const r = await rebalance(repo, user.accountId, c.req.valid('param').id);
      if (!r) return c.json({ error: 'experimento não está em execução com alocação automática' }, 404);
      if (r.changed && publish) {
        const p = await publish(user.accountId, user);
        if ('error' in p) return c.json({ ...r, publishError: p.error }, 200);
      }
      return c.json(r, 200);
    },
  );
}
