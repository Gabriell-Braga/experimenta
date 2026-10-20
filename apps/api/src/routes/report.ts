import { createRoute, z } from '@hono/zod-openapi';
import { attribute, goalConversions, loadTouches } from '../analytics/attribution';
import {
  CUPED_LOOKBACK_DAYS,
  deviceByVisitor,
  experimentReport,
  preExposureActivity,
} from '../analytics/report';
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
        'Visitantes, conversões e receita por variação e meta, com estatística bayesiana e frequentista (teste sequencial, CUPED e metas de guarda opcionais), série diária acumulada, SRM e duração estimada',
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
      let covariate: Map<string, number> | undefined;
      const cuped = !!rec.experiment.stats?.cuped;
      if (q.device || cuped) {
        const ids = [...new Set(events.filter((e) => e.type === 'exposure').map((e) => e.visitorId))];
        // Uma consulta só para os dois: CUPED olha até 30 dias antes da 1ª exposição (que pode ser anterior
        // ao período), então busca também as exposições e começa mais cedo.
        const visitorEvents = await repo.listEvents(accountId, {
          types: cuped ? ['pageview', 'exposure'] : ['pageview'],
          visitorIds: ids,
          from: cuped ? new Date(range.from.getTime() - CUPED_LOOKBACK_DAYS * 86_400_000) : range.from,
          to: range.to,
        });
        if (cuped) covariate = preExposureActivity(rec.experiment.id, visitorEvents);
        if (q.device) {
          const from = range.from.getTime();
          const devices = deviceByVisitor(visitorEvents.filter((e) => e.type === 'pageview' && e.ts >= from));
          filter = (v) => devices.get(v) === q.device;
        }
      }
      return c.json(experimentReport(rec.experiment, events, range, filter, covariate), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/attribution',
      tags: ['relatórios'],
      security,
      summary:
        'Receita por canal no experimento: conversões e receita de uma meta (padrão: a primária) por variação e canal, origem e campanha, no primeiro toque e no último toque não direto',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({
          days: z.coerce.number().int().min(1).max(365).default(90),
          goalId: z.string().optional(),
        }),
      },
      responses: { 200: json(Report, 'atribuição'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const rec = await repo.getExperiment(accountId, c.req.valid('param').id);
      if (!rec) return c.json({ error: 'experimento não encontrado' }, 404);
      const exp = rec.experiment;
      const q = c.req.valid('query');
      const goal = exp.goals.find((g) => g.id === q.goalId) ?? exp.goals[0];
      if (!goal) return c.json({ error: 'experimento sem metas' }, 404);
      const range = period(q);
      const vids = exp.variations.map((v) => v.id);
      const conversions = goalConversions(
        await repo.listEvents(accountId, { experimentId: exp.id, types: ['conversion'], ...range }),
        goal.id,
        vids,
      );
      const touches = await loadTouches(repo, accountId, conversions, range);
      return c.json(
        {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          goalId: goal.id,
          goalKey: goal.key,
          variations: exp.variations.map((v) => ({ id: v.id, name: v.name })),
          ...attribute(conversions, touches, vids.length),
        },
        200,
      );
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
