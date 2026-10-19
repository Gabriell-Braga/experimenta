import { createRoute, z } from '@hono/zod-openapi';
import { ENTITY_SCHEMAS, type EntityKind } from '@abtest/shared';
import { forbid, hasRole } from '../auth';
import { errors, json, Report, security, type Api } from '../http';
import { randomToken } from '../crypto';
import { NotFoundError, type Repo } from '../repo';
import { forgetWebhooks } from '../webhooks';

export const ENTITY_PATHS = ['/entities/*'];

const Kind = z
  .enum(Object.keys(ENTITY_SCHEMAS) as [EntityKind, ...EntityKind[]])
  .openapi({ param: { name: 'kind', in: 'path' } });
const Id = z.string().openapi({ param: { name: 'id', in: 'path' } });
const Body = z.object({ name: z.string().min(1).max(120), data: z.unknown() });

/** Valida `data` pelo schema do tipo; devolve o dado normalizado ou a mensagem de erro. */
function validate(
  kind: EntityKind,
  data: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const r = ENTITY_SCHEMAS[kind].safeParse(data);
  // Webhook sem segredo ganha um gerado aqui (o destino usa para validar a assinatura).
  if (r.success && kind === 'webhook' && !(r.data as { secret: string }).secret)
    (r.data as { secret: string }).secret = `whsec_${randomToken(24)}`;
  return r.success
    ? { ok: true, data: r.data }
    : { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

/** CRUD genérico das entidades de configuração (funis, audiências, campanhas…). Ler: qualquer papel; gravar: editor. */
export function entityRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities/{kind}',
      tags: ['entidades'],
      security,
      summary: 'Lista as entidades de um tipo (mais recentes primeiro)',
      request: { params: z.object({ kind: Kind }) },
      responses: { 200: json(Report, 'lista'), ...errors },
    }),
    async (c) => c.json(await repo.listEntities(c.get('user').accountId, c.req.valid('param').kind), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities/{kind}/{id}',
      tags: ['entidades'],
      security,
      request: { params: z.object({ kind: Kind, id: Id }) },
      responses: { 200: json(Report, 'entidade'), ...errors },
    }),
    async (c) => {
      const { kind, id } = c.req.valid('param');
      const e = await repo.getEntity(c.get('user').accountId, kind, id);
      return e ? c.json(e, 200) : c.json({ error: 'não encontrado' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/entities/{kind}',
      tags: ['entidades'],
      security,
      summary: 'Cria uma entidade (data validado pelo schema do tipo)',
      request: { params: z.object({ kind: Kind }), body: json(Body, 'nome e dados') },
      responses: { 201: json(z.object({ id: z.string() }), 'criada'), 400: errors[404], ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      forgetWebhooks(user.accountId); // escrita: webhooks podem ter mudado
      const { kind } = c.req.valid('param');
      const body = c.req.valid('json');
      const v = validate(kind, body.data);
      if (!v.ok) return c.json({ error: v.error }, 400);
      const id = await repo.saveEntity(user.accountId, {
        kind,
        name: body.name,
        data: v.data,
        userId: user.id,
      });
      return c.json({ id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/entities/{kind}/{id}',
      tags: ['entidades'],
      security,
      request: { params: z.object({ kind: Kind, id: Id }), body: json(Body, 'nome e dados') },
      responses: { 200: json(z.object({ id: z.string() }), 'salva'), 400: errors[404], ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      forgetWebhooks(user.accountId); // escrita: webhooks podem ter mudado
      const { kind, id } = c.req.valid('param');
      const body = c.req.valid('json');
      const v = validate(kind, body.data);
      if (!v.ok) return c.json({ error: v.error }, 400);
      try {
        await repo.saveEntity(user.accountId, { id, kind, name: body.name, data: v.data });
      } catch (e) {
        if (e instanceof NotFoundError) return c.json({ error: 'não encontrado' }, 404);
        throw e;
      }
      return c.json({ id }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/entities/{kind}/{id}',
      tags: ['entidades'],
      security,
      request: { params: z.object({ kind: Kind, id: Id }) },
      responses: { 204: { description: 'removida' }, ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      forgetWebhooks(user.accountId); // escrita: webhooks podem ter mudado
      const { kind, id } = c.req.valid('param');
      return (await repo.deleteEntity(user.accountId, kind, id))
        ? c.body(null, 204)
        : c.json({ error: 'não encontrado' }, 404);
    },
  );
}
