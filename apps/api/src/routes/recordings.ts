import { createRoute, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

export const RECORDING_PATHS = ['/recordings', '/recordings/*'];

/** Bloco enviado pelo `insights.js` (eventos do rrweb, até ~500 KB). */
const ChunkSchema = z.object({
  accountId: z.string().min(1),
  sessionId: z.string().min(1).max(100),
  visitorId: z.string().min(1).max(100),
  device: z.enum(['desktop', 'tablet', 'mobile']),
  vw: z.number().int().nonnegative(),
  vh: z.number().int().nonnegative(),
  events: z
    .array(z.object({ timestamp: z.number(), type: z.number().int() }).passthrough())
    .min(1)
    .max(5000),
});

const MAX_CHUNK = 1024 * 1024;

/** Gravação de sessão (tarefas 10.3/10.4): recebimento público dos blocos e leitura privada. */
export function recordingRoutes(app: Api, repo: Repo) {
  // Público (site do cliente): text/plain sem preflight, como o /collect.
  app.use('/rec', cors({ origin: '*', allowMethods: ['POST'] }));
  app.post('/rec', async (c) => {
    const raw = await c.req.text();
    if (raw.length > MAX_CHUNK) return c.json({ error: 'bloco grande demais' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: 'JSON inválido' }, 400);
    }
    const r = ChunkSchema.safeParse(body);
    if (!r.success) return c.json({ error: 'bloco inválido' }, 400);
    if (!(await repo.accountExists(r.data.accountId))) return c.body(null, 204);
    const { accountId, ...chunk } = r.data;
    await repo.saveRecordingChunk(accountId, chunk as Parameters<Repo['saveRecordingChunk']>[1]);
    return c.body(null, 204);
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/recordings',
      tags: ['insights'],
      security,
      summary:
        'Sessões gravadas (mais recentes primeiro) com páginas, duração, cliques e frustração; filtros de período, dispositivo, página, duração mínima e só com frustração',
      request: {
        query: PeriodQuery.extend({
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
          page: z.string().optional(),
          minSeconds: z.coerce.number().min(0).optional(),
          frustrated: z.enum(['1']).optional(),
          visitorId: z.string().optional(),
        }),
      },
      responses: { 200: json(Report, 'sessões'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const q = c.req.valid('query');
      const range = period(q);
      const [list, evs] = await Promise.all([
        repo.listRecordings(accountId, {
          ...range,
          device: q.device,
          visitorIds: q.visitorId ? [q.visitorId] : undefined,
          limit: 500,
        }),
        repo.listEvents(accountId, { ...range, types: ['click', 'frustration', 'conversion', 'event'] }),
      ]);
      const stats = new Map<
        string,
        { clicks: number; rage: number; dead: number; conversions: number; customEvents: number }
      >();
      for (const e of evs) {
        if (!e.sessionId) continue;
        let s = stats.get(e.sessionId);
        if (!s)
          stats.set(e.sessionId, (s = { clicks: 0, rage: 0, dead: 0, conversions: 0, customEvents: 0 }));
        if (e.type === 'click') s.clicks++;
        else if (e.type === 'frustration') s[e.kind]++;
        else if (e.type === 'conversion') s.conversions++;
        else if (e.type === 'event') s.customEvents++;
      }
      const rows = list
        .map((r) => ({
          ...r,
          ...(stats.get(r.sessionId) ?? { clicks: 0, rage: 0, dead: 0, conversions: 0, customEvents: 0 }),
        }))
        .filter(
          (r) =>
            (!q.page || r.pages.some((p) => p.includes(q.page!))) &&
            (!q.minSeconds || r.durationMs >= q.minSeconds * 1000) &&
            (!q.frustrated || r.rage + r.dead > 0),
        );
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/recordings/{sessionId}',
      tags: ['insights'],
      security,
      summary:
        'Eventos rrweb da sessão e linha do tempo dos nossos eventos (páginas, cliques, frustração, conversões)',
      request: {
        params: z.object({ sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }) }),
      },
      responses: { 200: json(Report, 'gravação'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const { sessionId } = c.req.valid('param');
      const [events, timeline] = await Promise.all([
        repo.getRecordingEvents(accountId, sessionId),
        repo.listEvents(accountId, {
          sessionId,
          types: ['pageview', 'click', 'frustration', 'conversion', 'event', 'identify'],
        }),
      ]);
      if (!events) return c.json({ error: 'gravação não encontrada' }, 404);
      return c.json({ sessionId, events, timeline }, 200);
    },
  );
}
