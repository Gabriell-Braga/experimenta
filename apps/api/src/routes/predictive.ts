import { createRoute } from '@hono/zod-openapi';
import type { PropensityConfig } from '@abtest/shared';
import type { AppDeps } from '../app';
import { forbid, hasRole } from '../auth';
import { errors, json, Report, security, type Api } from '../http';
import { MODEL_KIND, retrainPropensity, type TrainedModel } from '../predict';
import type { Repo } from '../repo';

export const PREDICTIVE_PATHS = ['/predictive', '/predictive/*'];

/** Analytics preditivo (tarefa 15.3): configuração + modelo treinado; treino sob demanda. */
export function predictiveRoutes(app: Api, repo: Repo, publish?: AppDeps['publish']) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/predictive',
      tags: ['insights'],
      security,
      summary: 'Configuração do modelo de propensão e o último modelo treinado (AUC, decis, pesos)',
      responses: { 200: json(Report, '{ config, model }'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const [cfg, model] = await Promise.all([
        repo.listEntities<PropensityConfig>(accountId, 'propensity'),
        repo.listEntities<TrainedModel>(accountId, MODEL_KIND),
      ]);
      return c.json({ config: cfg[0] ?? null, model: model[0]?.data ?? null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/predictive/train',
      tags: ['insights'],
      security,
      summary: 'Treina agora com os últimos 90 dias e publica o modelo (o snippet passa a calcular o score)',
      responses: { 200: json(Report, 'modelo'), 400: errors[404], ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const r = await retrainPropensity(repo, user.accountId);
      if ('error' in r) return c.json({ error: r.error }, 400);
      await publish?.(user.accountId, user);
      return c.json(r, 200);
    },
  );
}
