import { createRoute, z } from '@hono/zod-openapi';
import { compileFunnel, type Experiment } from '@abtest/shared';
import { cors } from 'hono/cors';
import { canPublishJs, forbid, hasRole } from '../auth';
import { randomToken, sha256hex } from '../crypto';
import { errors, json, security, type Api } from '../http';
import type { Repo } from '../repo';

// Link de pré-visualização (fase 17.3, D-077): mostra o RASCUNHO de uma variação no site real, sem publicar.
// Token `<id>.<segredo>`; só o hash fica guardado (entidade `preview`, fora das rotas genéricas de entidades).
// O snippet do site busca o experimento compilado em `GET /preview/:conta/:token`.

export const PREVIEW_KIND = 'preview';
export const PREVIEW_HOURS = [1, 24, 168, 720] as const;

export interface PreviewData {
  experimentId: string;
  variationId: string;
  hash: string;
  expiresAt: string;
  /** Quem criou podia publicar JS: só então o customJS do rascunho roda no link. */
  js: boolean;
}

const PreviewOut = z
  .object({
    id: z.string(),
    variationId: z.string(),
    variationName: z.string(),
    expiresAt: z.string(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('PreviewLink');
const ExpParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

/**
 * Experimento que o preview.js aplica: o rascunho compilado como na publicação (funil), só com a variação do
 * link, sempre "no ar" para quem tem o link (sem tráfego, audiências, grupo nem segmentação além das URLs).
 * Id próprio: a atribuição que o snippet guarda no navegador não vaza para o teste real depois.
 */
export function previewExperiment(exp: Experiment, variationId: string, js: boolean): Experiment | null {
  if (exp.type === 'server') return null;
  const c = compileFunnel(exp);
  const v = c.variations.find((x) => x.id === variationId);
  if (!v) return null;
  return {
    ...c,
    id: `preview_${exp.id}`,
    // Hipótese é da equipe: não vai para o site.
    hypothesis: undefined,
    status: 'running',
    traffic: 100,
    audiences: [],
    group: undefined,
    allocation: 'manual',
    segmentation: { urls: c.segmentation.urls, devices: [], query: [], visitor: 'all' },
    variations: [{ ...v, weight: 1, customJS: js ? v.customJS : '' }],
  };
}

const expired = (d: PreviewData, now = Date.now()) => Date.parse(d.expiresAt) <= now;

export function previewRoutes(app: Api, repo: Repo) {
  // ---------- Pública (snippet no site do cliente) ----------
  app.use('/preview/*', cors({ origin: '*', allowMethods: ['GET'] }));
  app.get('/preview/:account/:token', async (c) => {
    const { account, token } = c.req.param();
    c.header('Cache-Control', 'no-store');
    const gone = () => c.json({ error: 'link inválido, expirado ou revogado' }, 404);
    const id = token.split('.')[0];
    if (!id || !token.includes('.')) return gone();
    // Conta da URL + id do token: o link de uma conta nunca acha nada em outra.
    const link = await repo.getEntity<PreviewData>(account, PREVIEW_KIND, id);
    if (!link || link.data.hash !== (await sha256hex(token)) || expired(link.data)) return gone();
    const rec = await repo.getExperiment(account, link.data.experimentId);
    const experiment = rec && previewExperiment(rec.experiment, link.data.variationId, link.data.js);
    if (!experiment) return gone();
    return c.json({ experiment, expiresAt: link.data.expiresAt });
  });

  // ---------- Privadas (editor; `/experiments/*` já exige login) ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/previews',
      tags: ['experimentos'],
      security,
      summary: 'Links de pré-visualização ainda válidos do experimento',
      request: { params: ExpParam },
      responses: { 200: json(z.array(PreviewOut), 'links'), ...errors },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      const { id } = c.req.valid('param');
      const rec = await repo.getExperiment(accountId, id);
      if (!rec) return c.json({ error: 'não encontrado' }, 404);
      const names = new Map(rec.experiment.variations.map((v) => [v.id, v.name]));
      const links = await repo.listEntities<PreviewData>(accountId, PREVIEW_KIND);
      return c.json(
        links
          .filter((l) => l.data.experimentId === id && !expired(l.data))
          .map((l) => ({
            id: l.id,
            variationId: l.data.variationId,
            variationName: names.get(l.data.variationId) ?? l.name,
            expiresAt: l.data.expiresAt,
            createdBy: l.createdBy,
            createdAt: l.createdAt,
          })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments/{id}/previews',
      tags: ['experimentos'],
      security,
      summary: 'Cria um link de pré-visualização do rascunho de uma variação (o token aparece UMA vez)',
      request: {
        params: ExpParam,
        body: json(
          z.object({
            variationId: z.string().min(1),
            hours: z.coerce
              .number()
              .refine((h) => (PREVIEW_HOURS as readonly number[]).includes(h), 'use 1, 24, 168 ou 720'),
          }),
          'variação e validade',
        ),
      },
      responses: {
        201: json(
          z.object({
            id: z.string(),
            token: z.string(),
            url: z.string(),
            expiresAt: z.string(),
            variationName: z.string(),
          }),
          'criado',
        ),
        400: errors[404],
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id } = c.req.valid('param');
      const { variationId, hours } = c.req.valid('json');
      const rec = await repo.getExperiment(user.accountId, id);
      if (!rec) return c.json({ error: 'não encontrado' }, 404);
      const variation = rec.experiment.variations.find((v) => v.id === variationId);
      if (!variation) return c.json({ error: 'variação não encontrada' }, 400);
      if (rec.experiment.type === 'server')
        return c.json({ error: 'teste server-side não tem pré-visualização no site' }, 400);
      // Links vencidos da conta saem aqui (ninguém mais consegue usá-los).
      const old = await repo.listEntities<PreviewData>(user.accountId, PREVIEW_KIND);
      await Promise.all(
        old.filter((l) => expired(l.data)).map((l) => repo.deleteEntity(user.accountId, PREVIEW_KIND, l.id)),
      );
      const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      // Grava primeiro sem hash para ter o id que vai no token; o link só passa a valer com o hash.
      const data: PreviewData = {
        experimentId: id,
        variationId,
        hash: '',
        expiresAt,
        js: canPublishJs(user),
      };
      const pid = await repo.saveEntity(user.accountId, {
        kind: PREVIEW_KIND,
        name: variation.name,
        data,
        userId: user.id,
      });
      const token = `${pid}.${randomToken(24)}`;
      await repo.saveEntity(user.accountId, {
        id: pid,
        kind: PREVIEW_KIND,
        name: variation.name,
        data: { ...data, hash: await sha256hex(token) },
      });
      // Abre na 1ª página do funil (multipágina) ou na página do editor.
      const url = new URL(rec.experiment.pages?.[0]?.url ?? rec.editorUrl);
      url.searchParams.set('abt_preview', token);
      return c.json({ id: pid, token, url: url.href, expiresAt, variationName: variation.name }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/experiments/{id}/previews/{pid}',
      tags: ['experimentos'],
      security,
      summary: 'Revoga um link de pré-visualização (para de funcionar na próxima página aberta)',
      request: {
        params: ExpParam.extend({ pid: z.string().openapi({ param: { name: 'pid', in: 'path' } }) }),
      },
      responses: { 204: { description: 'revogado' }, ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, pid } = c.req.valid('param');
      const link = await repo.getEntity<PreviewData>(user.accountId, PREVIEW_KIND, pid);
      if (!link || link.data.experimentId !== id) return c.json({ error: 'não encontrado' }, 404);
      await repo.deleteEntity(user.accountId, PREVIEW_KIND, pid);
      return c.body(null, 204);
    },
  );
}
