import { createRoute, z } from '@hono/zod-openapi';
import type { AppDeps } from '../app';
import { canPublishJs, forbid, hasRole } from '../auth';
import { errors, ErrorSchema, json, security, type Api } from '../http';
import type { Entity, Repo, User } from '../repo';
import { dispatchNotice, dispatchPublish } from '../webhooks';
import { background } from './integrations';

// Fluxo de aprovação de publicação (fase 16.4, D-072). Com `requireApproval` na conta, quem não pode aprovar
// recebe 202 no POST /publish e vira um pedido; quem pode (owner ou "publica JS") aprova (= publica) ou recusa.

export const APPROVAL_PATHS = ['/publish-requests', '/publish-requests/*'];
export const REQUEST_KIND = 'publish-request';

interface Person {
  id: string;
  name: string;
}
export interface PublishRequestData {
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  requestedBy: Person;
  decidedBy?: Person;
  decidedAt?: string;
  comment?: string;
  /** Versão publicada na aprovação. */
  version?: number;
}

/** Aprova quem pode publicar tudo, inclusive JavaScript: owner ou membro com "publica JS". */
export const canApprove = (user: User) => hasRole(user, 'editor') && canPublishJs(user);

const person = (u: User): Person => ({
  id: u.id,
  name: u.id.startsWith('apikey:') ? `Chave de API: ${u.name}` : u.name,
});

const PublishRequestOut = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    note: z.string(),
    requestedBy: z.object({ id: z.string(), name: z.string() }),
    decidedBy: z.object({ id: z.string(), name: z.string() }).optional(),
    decidedAt: z.string().optional(),
    comment: z.string().optional(),
    version: z.number().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PublishRequest');
type Out = z.infer<typeof PublishRequestOut>;

const out = (e: { id: string; data: PublishRequestData; createdAt: string; updatedAt: string }): Out => ({
  id: e.id,
  ...e.data,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

const notify = (repo: Repo, accountId: string, r: Out) =>
  dispatchNotice(repo, accountId, 'approval', { status: r.status, request: r });

/**
 * Pede publicação: um pedido pendente por pessoa (pedir de novo atualiza a hora e, se vier, o recado).
 * Devolve o pedido e se é novo (só pedido novo avisa por webhook).
 */
export async function requestPublish(repo: Repo, user: User, note = '') {
  const mine = (await repo.listEntities<PublishRequestData>(user.accountId, REQUEST_KIND)).find(
    (r) => r.data.status === 'pending' && r.data.requestedBy.id === user.id,
  );
  const data: PublishRequestData = mine
    ? { ...mine.data, note: note || mine.data.note }
    : { status: 'pending', note, requestedBy: person(user) };
  const id = await repo.saveEntity(user.accountId, {
    id: mine?.id,
    kind: REQUEST_KIND,
    name: data.requestedBy.name,
    data,
    userId: user.id,
  });
  const now = new Date().toISOString();
  return { request: out({ id, data, createdAt: mine?.createdAt ?? now, updatedAt: now }), created: !mine };
}

/** Publicação de quem pode aprovar: os pedidos pendentes foram ao ar junto (aprovados com essa versão). */
export async function settleRequests(
  repo: Repo,
  user: User,
  version: number,
  first?: { id: string; comment: string },
) {
  const pending = (await repo.listEntities<PublishRequestData>(user.accountId, REQUEST_KIND)).filter(
    (r) => r.data.status === 'pending',
  );
  const done: Out[] = [];
  for (const r of pending) {
    const data: PublishRequestData = {
      ...r.data,
      status: 'approved',
      decidedBy: person(user),
      decidedAt: new Date().toISOString(),
      comment: r.id === first?.id ? first.comment : '',
      version,
    };
    await repo.saveEntity(user.accountId, { id: r.id, kind: REQUEST_KIND, name: r.name, data });
    done.push(out({ ...r, data, updatedAt: data.decidedAt! }));
  }
  return done;
}

const Id = z.object({
  id: z
    .string()
    .max(100)
    .openapi({ param: { name: 'id', in: 'path' } }),
});
const Comment = z.object({ comment: z.string().trim().max(1000).default('') });

export function approvalRoutes(app: Api, repo: Repo, publish?: AppDeps['publish']) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/publish-requests',
      tags: ['publish'],
      security,
      summary: 'Pedidos de publicação (pendentes primeiro, depois os 50 últimos decididos)',
      responses: { 200: json(z.array(PublishRequestOut), 'pedidos'), ...errors },
    }),
    async (c) => {
      const all = (await repo.listEntities<PublishRequestData>(c.get('user').accountId, REQUEST_KIND)).map(
        out,
      );
      const pending = all.filter((r) => r.status === 'pending');
      return c.json([...pending, ...all.filter((r) => r.status !== 'pending').slice(0, 50)], 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/publish-requests',
      tags: ['publish'],
      security,
      summary: 'Pede publicação com um recado (conta com aprovação; editor sem permissão de aprovar)',
      request: { body: json(z.object({ note: z.string().trim().max(1000).default('') }), 'recado') },
      responses: { 201: json(PublishRequestOut, 'pedido'), 400: json(ErrorSchema, 'inválido'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      if (canApprove(user)) return c.json({ error: 'você pode publicar direto' }, 400);
      if (!(await repo.getAccountSettings(user.accountId)).requireApproval)
        return c.json({ error: 'esta conta não exige aprovação: publique direto' }, 400);
      const { request, created } = await requestPublish(repo, user, c.req.valid('json').note);
      if (created) background(c, notify(repo, user.accountId, request));
      return c.json(request, 201);
    },
  );

  const decide = async (
    id: string,
    user: User,
  ): Promise<{ r: Entity<PublishRequestData> } | { error: string; status: 404 | 409 }> => {
    const r = await repo.getEntity<PublishRequestData>(user.accountId, REQUEST_KIND, id);
    if (!r) return { error: 'pedido não encontrado', status: 404 as const };
    if (r.data.status !== 'pending') return { error: 'este pedido já foi decidido', status: 409 as const };
    return { r };
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/publish-requests/{id}/approve',
      tags: ['publish'],
      security,
      summary: 'Aprova: publica a configuração atual (owner ou "publica JS"); os outros pendentes vão junto',
      request: { params: Id, body: json(Comment, 'comentário opcional') },
      responses: {
        200: json(z.object({ version: z.number() }), 'publicado'),
        400: json(ErrorSchema, 'inválido'),
        409: json(ErrorSchema, 'já decidido'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!canApprove(user)) return forbid(c, 'só owner ou quem publica JS aprova');
      const d = await decide(c.req.valid('param').id, user);
      if ('error' in d) return c.json({ error: d.error }, d.status);
      if (!publish) return c.json({ error: 'publicação indisponível' }, 400);
      const p = await publish(user.accountId, user);
      if ('error' in p) return c.json({ error: p.error }, p.status);
      const done = await settleRequests(repo, user, p.version, {
        id: d.r.id,
        comment: c.req.valid('json').comment,
      });
      background(
        c,
        Promise.all([
          dispatchPublish(repo, user.accountId, p.version),
          ...done.map((r) => notify(repo, user.accountId, r)),
        ]),
      );
      return c.json({ version: p.version }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/publish-requests/{id}/reject',
      tags: ['publish'],
      security,
      summary: 'Recusa com comentário (obrigatório: diz o que mudar)',
      request: {
        params: Id,
        body: json(z.object({ comment: z.string().trim().min(1).max(1000) }), 'motivo'),
      },
      responses: {
        200: json(PublishRequestOut, 'recusado'),
        409: json(ErrorSchema, 'já decidido'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!canApprove(user)) return forbid(c, 'só owner ou quem publica JS recusa');
      const d = await decide(c.req.valid('param').id, user);
      if ('error' in d) return c.json({ error: d.error }, d.status);
      const data: PublishRequestData = {
        ...d.r.data,
        status: 'rejected',
        decidedBy: person(user),
        decidedAt: new Date().toISOString(),
        comment: c.req.valid('json').comment,
      };
      await repo.saveEntity(user.accountId, { id: d.r.id, kind: REQUEST_KIND, name: d.r.name, data });
      const r = out({ ...d.r, data, updatedAt: data.decidedAt! });
      background(c, notify(repo, user.accountId, r));
      return c.json(r, 200);
    },
  );
}
