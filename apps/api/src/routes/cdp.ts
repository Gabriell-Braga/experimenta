import { createRoute, z } from '@hono/zod-openapi';
import type { RecoModel, Segment } from '@abtest/shared';
import { recommend } from '@abtest/shared';
import { chooseVariation } from '@abtest/snippet/bucket';
import {
  buildProfiles,
  crossDevice,
  matchSegment,
  profileMatches,
  type ProfileSummary,
} from '../analytics/profiles';
import type { CdnStore } from '../cdn';
import { recoFile } from '../reco';
import { errors, json, period, PeriodQuery, Report, security, type Api } from '../http';
import type { Repo } from '../repo';

export const CDP_PATHS = ['/profiles', '/profiles/*', '/decide'];
const TYPES = ['pageview', 'event', 'identify', 'conversion', 'exposure'];

/** CDP: perfis unificados por identidade (fase 14.1). */
export function cdpRoutes(app: Api, repo: Repo, cdn: CdnStore) {
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

  app.openapi(
    createRoute({
      method: 'get',
      path: '/profiles/segments/{id}',
      tags: ['cdp'],
      security,
      summary: 'Membros de um segmento do CDP (perfis que atendem às regras); `format=csv` exporta',
      request: {
        params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
        query: PeriodQuery.extend({
          days: z.coerce.number().int().min(1).max(365).default(90),
          format: z.enum(['json', 'csv']).default('json'),
        }),
      },
      responses: { 200: json(Report, '{ count, profiles }'), ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const seg = await repo.getEntity<Segment>(accountId, 'segment', c.req.valid('param').id);
      if (!seg) return c.json({ error: 'segmento não encontrado' }, 404);
      const q = c.req.valid('query');
      const list = await repo.listEvents(accountId, { ...period(q), types: TYPES });
      const members = [...buildProfiles(list).values()]
        .filter((p) => matchSegment(p, seg.data))
        .sort((a, b) => b.lastSeen - a.lastSeen);
      if (q.format === 'csv') {
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const keys = [...new Set(members.flatMap((p) => Object.keys(p.attributes)))];
        const rows = [
          [
            'perfil',
            'usuario',
            'visitantes',
            'dispositivos',
            'sessoes',
            'conversoes',
            'receita',
            'ultima_visita',
            ...keys,
          ],
          ...members.map((p) => [
            p.id,
            p.userId ?? '',
            p.visitors.join(' '),
            p.devices.join(' '),
            p.sessions,
            p.conversions,
            p.revenue.toFixed(2),
            new Date(p.lastSeen).toISOString(),
            ...keys.map((k) => p.attributes[k] ?? ''),
          ]),
        ];
        c.header('Content-Type', 'text/csv; charset=utf-8');
        c.header('Content-Disposition', `attachment; filename="segmento-${seg.id}.csv"`);
        return c.body(rows.map((r) => r.map(esc).join(',')).join('\n')) as never;
      }
      return c.json(
        { id: seg.id, name: seg.name, count: members.length, profiles: members.slice(0, 500) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/decide',
      tags: ['cdp'],
      security,
      summary:
        'Decisão cross-channel (app, e-mail, backend): segmentos do perfil, variação de cada campanha server-side e próxima melhor oferta',
      request: {
        query: z.object({
          user: z.string().optional(),
          visitor: z.string().optional(),
          days: z.coerce.number().int().min(1).max(365).default(90),
        }),
      },
      responses: { 200: json(Report, 'decisão'), 400: errors[404], ...errors },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const q = c.req.valid('query');
      if (!q.user && !q.visitor) return c.json({ error: 'informe user ou visitor' }, 400);
      const [list, segments, pub, reco] = await Promise.all([
        repo.listEvents(accountId, { ...period(q), types: TYPES }),
        repo.listEntities<Segment>(accountId, 'segment'),
        repo.lastPublication(accountId),
        cdn.get(recoFile(accountId)),
      ]);
      const profiles = buildProfiles(list);
      const id = q.user ? `u:${q.user}` : `v:${q.visitor}`;
      // Visitante já identificado: a decisão é sobre o usuário dele.
      const profile: ProfileSummary | undefined =
        profiles.get(id) ??
        (q.visitor ? [...profiles.values()].find((p) => p.visitors.includes(q.visitor!)) : undefined);
      // Bucketing pela identidade mais estável (mesma função do snippet/SDK).
      const unit = profile?.userId ?? q.user ?? q.visitor!;
      const experiments = (pub?.config.experiments ?? [])
        .filter((e) => e.status === 'running' && e.type === 'server')
        .map((e) => {
          const v = chooseVariation(unit, e);
          return { key: e.key, variation: v?.key ?? null, variables: v?.variables ?? {} };
        });
      const model = reco ? (JSON.parse(reco) as RecoModel) : null;
      return c.json(
        {
          profile: profile
            ? {
                id: profile.id,
                userId: profile.userId ?? null,
                attributes: profile.attributes,
                sessions: profile.sessions,
                conversions: profile.conversions,
                revenue: profile.revenue,
              }
            : null,
          segments: profile
            ? segments.filter((s) => matchSegment(profile, s.data)).map((s) => ({ id: s.id, name: s.name }))
            : [],
          experiments,
          recommendations: model
            ? recommend(model, 'nbo', { limit: 4 }).map((pid) => ({ id: pid, ...model.catalog[pid] }))
            : [],
        },
        200,
      );
    },
  );
}
