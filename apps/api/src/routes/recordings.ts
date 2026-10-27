import { createRoute, z } from '@hono/zod-openapi';
import type { Segment } from '@abtest/shared';
import { cors } from 'hono/cors';
import { buildProfiles, matchSegment, PROFILE_EVENT_TYPES } from '../analytics/profiles';
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

function utmOf(url: string): { source?: string; medium?: string; campaign?: string } {
  try {
    const q = new URL(url).searchParams;
    const v = (k: string) => q.get(`utm_${k}`) || undefined;
    return { source: v('source'), medium: v('medium'), campaign: v('campaign') };
  } catch {
    return {};
  }
}

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
        'Sessões gravadas (mais recentes primeiro) com páginas, duração, cliques, frustração, UTMs, país/estado e eventos; filtros de período, dispositivo, página, duração mínima, só com frustração e segmento do CDP',
      request: {
        query: PeriodQuery.extend({
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
          page: z.string().optional(),
          minSeconds: z.coerce.number().min(0).optional(),
          frustrated: z.enum(['1']).optional(),
          visitorId: z.string().optional(),
          /** Segmento do CDP: só sessões de visitantes que atendem às regras no período. */
          segment: z.string().optional(),
        }),
      },
      responses: { 200: json(Report, 'sessões'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const q = c.req.valid('query');
      const range = period(q);
      const seg = q.segment ? await repo.getEntity<Segment>(accountId, 'segment', q.segment) : null;
      if (q.segment && !seg) return c.json({ error: 'segmento não encontrado' }, 404);
      const [list, evs, profileEvents] = await Promise.all([
        repo.listRecordings(accountId, {
          ...range,
          device: q.device,
          visitorIds: q.visitorId ? [q.visitorId] : undefined,
          limit: 500,
        }),
        repo.listEvents(accountId, {
          ...range,
          types: ['pageview', 'click', 'frustration', 'conversion', 'event'],
        }),
        seg ? repo.listEvents(accountId, { ...range, types: PROFILE_EVENT_TYPES }) : null,
      ]);
      const inSegment = profileEvents
        ? new Set(
            [...buildProfiles(profileEvents).values()]
              .filter((p) => matchSegment(p, seg!.data))
              .flatMap((p) => p.visitors),
          )
        : null;
      type Stats = {
        clicks: number;
        rage: number;
        dead: number;
        conversions: number;
        customEvents: number;
        utm: { source?: string; medium?: string; campaign?: string };
        country?: string;
        region?: string;
        eventNames: string[];
        _first: number;
      };
      const empty = (): Stats => ({
        clicks: 0,
        rage: 0,
        dead: 0,
        conversions: 0,
        customEvents: 0,
        utm: {},
        eventNames: [],
        _first: Infinity,
      });
      const stats = new Map<string, Stats>();
      for (const e of evs) {
        if (!e.sessionId) continue;
        let s = stats.get(e.sessionId);
        if (!s) stats.set(e.sessionId, (s = empty()));
        if (e.type === 'click') s.clicks++;
        else if (e.type === 'frustration') s[e.kind]++;
        else if (e.type === 'conversion') s.conversions++;
        else if (e.type === 'event') {
          s.customEvents++;
          if (!s.eventNames.includes(e.name)) s.eventNames.push(e.name);
        } else if (e.type === 'pageview' && e.ts < s._first) {
          // Origem da sessão = 1ª página (UTMs da URL de entrada) e geo do IP.
          s._first = e.ts;
          s.utm = utmOf(e.url);
          s.country = e.country;
          s.region = e.region;
        }
      }
      const rows = list
        .filter((r) => !inSegment || inSegment.has(r.visitorId))
        .map((r) => {
          const { _first, ...s } = stats.get(r.sessionId) ?? empty();
          return { ...r, ...s };
        })
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
