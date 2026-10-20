import { createRoute, z } from '@hono/zod-openapi';
import type Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL, claudeIdeas, compatIdeas, ruleIdeas, type CompatAi } from '../ai';
import { forbid, hasRole } from '../auth';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';
import { loadDashboard } from './data';

export const AI_PATHS = ['/ai/*'];

/** Otimização por IA (tarefa 15.4): ideias de teste a partir do painel. */
export function aiRoutes(app: Api, repo: Repo, client?: Anthropic, compat?: CompatAi) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/ideas',
      tags: ['insights'],
      security,
      summary:
        'Ideias de teste priorizadas a partir do painel do período: com Claude (ANTHROPIC_API_KEY) ou um modelo grátis compatível com OpenAI (AI_BASE_URL), senão pelas regras dos insights',
      request: { query: PeriodQuery },
      responses: {
        200: json(
          z.object({
            source: z.enum(['claude', 'modelo', 'regras']),
            model: z.string().optional(),
            ideas: Report,
          }),
          'ideias',
        ),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const d = await loadDashboard(repo, user.accountId, period(c.req.valid('query')));
      if (client)
        try {
          return c.json(
            { source: 'claude' as const, model: AI_MODEL, ideas: await claudeIdeas(client, d) },
            200,
          );
        } catch (e) {
          console.error('[api] ideias com Claude falharam; usando regras', e);
        }
      else if (compat)
        try {
          return c.json({ source: 'modelo' as const, ...(await compatIdeas(compat, d)) }, 200);
        } catch (e) {
          console.error(`[api] ideias com ${compat.model} falharam; usando regras`, e);
        }
      return c.json({ source: 'regras' as const, ideas: ruleIdeas(d.insights) }, 200);
    },
  );
}
