import { createRoute, z } from '@hono/zod-openapi';
import { buildProfiles } from '../analytics/profiles';
import { forbid, hasRole } from '../auth';
import { errors, ErrorSchema, json, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

// Direitos do titular (20.6; LGPD art. 18, GDPR art. 15 e 17): o owner exporta ou apaga tudo de um visitante
// (cookie) ou de um usuário do CDP (`identify`, que junta os visitantes dele). Eventos (inclui atributos do
// identify, respostas de pesquisa e formulário), gravações e perfil. Registrado no histórico (audit.ts).
export const PRIVACY_PATHS = ['/privacy/*'];

const Subject = z
  .object({
    visitorId: z.string().trim().min(1).max(200).optional(),
    userId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((s) => !!s.visitorId !== !!s.userId, 'informe visitorId ou userId (um dos dois)');

/** Visitantes do titular: o próprio id ou todos os que se identificaram com o usuário. */
async function visitorsOf(repo: Repo, accountId: string, s: z.infer<typeof Subject>) {
  if (s.visitorId) return [s.visitorId];
  // ponytail: varre os identify da conta (teto EVENT_LIMIT); índice por payload.userId se o volume passar disso.
  const ids = await repo.listEvents(accountId, { types: ['identify'] });
  return [
    ...new Set(ids.filter((e) => e.type === 'identify' && e.userId === s.userId).map((e) => e.visitorId)),
  ];
}

export function privacyRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/privacy/subject',
      tags: ['privacidade'],
      security,
      summary: 'Exporta (JSON) todos os dados de um visitante ou usuário do CDP (só owner)',
      request: { query: Subject },
      responses: {
        200: json(
          Report,
          '{ subject, visitorIds, profiles, events, surveys, forms, recordings[{ ...meta, events }] }',
        ),
        400: json(ErrorSchema, 'sem visitorId/userId'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const s = c.req.valid('query');
      const visitorIds = await visitorsOf(repo, me.accountId, s);
      const events = visitorIds.length ? await repo.listEvents(me.accountId, { visitorIds }) : [];
      const metas = visitorIds.length
        ? await repo.listRecordings(me.accountId, { visitorIds, limit: 1000 })
        : [];
      const recordings = [];
      for (const r of metas)
        recordings.push({ ...r, events: (await repo.getRecordingEvents(me.accountId, r.sessionId)) ?? [] });
      return c.json(
        {
          subject: s,
          exportedAt: new Date().toISOString(),
          visitorIds,
          profiles: [...buildProfiles(events).values()],
          events,
          surveys: events.filter((e) => e.type === 'survey'),
          forms: events.filter((e) => e.type === 'form'),
          recordings,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/privacy/subject',
      tags: ['privacidade'],
      security,
      summary:
        'Apaga todos os dados de um visitante ou usuário do CDP: eventos, gravações e webhooks pendentes (só owner, irreversível)',
      request: { query: Subject },
      responses: {
        200: json(
          z.object({ visitorIds: z.array(z.string()), events: z.number(), recordings: z.number() }),
          'apagado',
        ),
        400: json(ErrorSchema, 'sem visitorId/userId'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const visitorIds = await visitorsOf(repo, me.accountId, c.req.valid('query'));
      return c.json({ visitorIds, ...(await repo.deleteVisitorData(me.accountId, visitorIds)) }, 200);
    },
  );
}
