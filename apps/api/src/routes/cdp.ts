import { createRoute, z } from '@hono/zod-openapi';
import { buildProfiles, crossDevice, profileMatches } from '../analytics/profiles';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

export const CDP_PATHS = ['/profiles', '/profiles/*'];
const TYPES = ['pageview', 'event', 'identify', 'conversion', 'exposure'];

/** CDP: perfis unificados por identidade (fase 14.1). */
export function cdpRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/profiles',
      tags: ['cdp'],
      security,
      summary:
        'Perfis (usuário identificado juntando visitantes/dispositivos, ou visitante anônimo), busca e resumo cross-device',
      request: {
        query: PeriodQuery.extend({
          q: z.string().optional(),
          kind: z.enum(['user', 'anon']).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
      responses: { 200: json(Report, '{ total, crossDevice, profiles }'), ...errors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const list = await repo.listEvents(c.get('user').accountId, { ...period(q), types: TYPES });
      const all = [...buildProfiles(list).values()];
      const shown = all
        .filter((p) => (!q.kind || p.kind === q.kind) && (!q.q || profileMatches(p, q.q)))
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return c.json(
        {
          total: all.length,
          identified: all.filter((p) => p.kind === 'user').length,
          crossDevice: crossDevice(all),
          profiles: shown.slice(0, q.limit),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/profiles/{id}',
      tags: ['cdp'],
      security,
      summary: 'Perfil: resumo, linha do tempo de todos os visitantes ligados e gravações',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({ days: z.coerce.number().int().min(1).max(365).default(90) }),
      },
      responses: { 200: json(Report, 'perfil'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const range = period(c.req.valid('query'));
      const id = c.req.valid('param').id;
      const list = await repo.listEvents(accountId, { ...range, types: TYPES });
      const profile = buildProfiles(list).get(id);
      if (!profile) return c.json({ error: 'perfil não encontrado' }, 404);
      const [timeline, recordings] = await Promise.all([
        repo.listEvents(accountId, { ...range, visitorIds: profile.visitors, order: 'desc', limit: 300 }),
        repo.listRecordings(accountId, { visitorIds: profile.visitors, limit: 50 }),
      ]);
      return c.json({ profile, timeline, recordings }, 200);
    },
  );
}
