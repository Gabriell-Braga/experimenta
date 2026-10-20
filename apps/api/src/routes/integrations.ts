import { createRoute, z } from '@hono/zod-openapi';
import type { Webhook } from '@abtest/shared';
import type { Context } from 'hono';
import { API_KEY_PREFIX, forbid, hasRole, type ApiKeyData } from '../auth';
import { randomToken, sha256hex } from '../crypto';
import { errors, json, Report, security, type Api } from '../http';
import type { Repo } from '../repo';
import { deliver, MAX_ATTEMPTS, retryDelivery } from '../webhooks';

export const INTEGRATION_PATHS = ['/account/api-keys', '/account/api-keys/*', '/webhooks/*'];

/** Tarefa em segundo plano: `waitUntil` no Worker; no Node, só não espera (erros ignorados). */
export function background(c: Context, p: Promise<unknown>) {
  const safe = p.catch(() => undefined);
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* Node: sem executionCtx */
  }
}

const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

/** Chaves de API (só owner) e teste de webhook (tarefa 14.4). */
export function integrationRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/account/api-keys',
      tags: ['integrações'],
      security,
      summary: 'Chaves de API da conta (só o começo de cada chave; o segredo não é guardado)',
      responses: { 200: json(Report, 'chaves'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'owner')) return forbid(c);
      const keys = await repo.listEntities<ApiKeyData>(user.accountId, 'apikey');
      return c.json(
        keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.data.prefix,
          role: k.data.role,
          createdAt: k.createdAt,
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/account/api-keys',
      tags: ['integrações'],
      security,
      summary: 'Cria uma chave de API (mostrada UMA vez). Use em `Authorization: Bearer <chave>`',
      request: {
        body: json(
          z.object({
            name: z.string().trim().min(1).max(80),
            role: z.enum(['viewer', 'editor']).default('viewer'),
          }),
          'chave',
        ),
      },
      responses: { 201: json(z.object({ id: z.string(), key: z.string() }), 'criada'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'owner')) return forbid(c);
      const { name, role } = c.req.valid('json');
      const key = `${API_KEY_PREFIX}${user.accountId}.${randomToken(24)}`;
      const data: ApiKeyData = {
        hash: await sha256hex(key),
        prefix: key.slice(0, API_KEY_PREFIX.length + user.accountId.length + 7),
        role,
      };
      const id = await repo.saveEntity(user.accountId, { kind: 'apikey', name, data, userId: user.id });
      return c.json({ id, key }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/account/api-keys/{id}',
      tags: ['integrações'],
      security,
      summary: 'Revoga uma chave de API (para de funcionar na hora)',
      request: { params: Id },
      responses: { 204: { description: 'revogada' }, ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'owner')) return forbid(c);
      return (await repo.deleteEntity(user.accountId, 'apikey', c.req.valid('param').id))
        ? c.body(null, 204)
        : c.json({ error: 'não encontrada' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/webhooks/{id}/test',
      tags: ['integrações'],
      security,
      summary: 'Envia um evento de teste assinado para o webhook e devolve o status HTTP do destino',
      request: { params: Id },
      responses: { 200: json(z.object({ status: z.number() }), 'resposta do destino'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const h = await repo.getEntity<Webhook>(user.accountId, 'webhook', c.req.valid('param').id);
      if (!h) return c.json({ error: 'webhook não encontrado' }, 404);
      const status = await deliver(h.data.url, h.data.secret, {
        account: user.accountId,
        type: 'test',
        events: [],
      });
      return c.json({ status }, 200);
    },
  );

  const DeliveryParams = z.object({
    id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
    deliveryId: z.string().openapi({ param: { name: 'deliveryId', in: 'path' } }),
  });
  /** Entrega sem o corpo (pode ser grande; o receptor já tem pelo id). */
  const view = ({ body, ...d }: Awaited<ReturnType<Repo['getWebhookDelivery']>> & object) => ({
    ...d,
    size: body.length,
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/webhooks/{id}/deliveries',
      tags: ['integrações'],
      security,
      summary:
        'Últimas entregas que falharam pelo menos uma vez (na fila, entregues num reenvio ou com falha) e contagens. Entrega certa de primeira não aparece',
      request: { params: Id },
      responses: { 200: json(Report, '{ deliveries, pending, failed, maxAttempts }'), ...errors },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      const id = c.req.valid('param').id;
      if (!(await repo.getEntity(accountId, 'webhook', id)))
        return c.json({ error: 'webhook não encontrado' }, 404);
      const [list, counts] = await Promise.all([
        repo.listWebhookDeliveries(accountId, id, 20),
        repo.countWebhookDeliveries(accountId, id),
      ]);
      return c.json({ deliveries: list.map(view), ...counts, maxAttempts: MAX_ATTEMPTS }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/webhooks/{id}/deliveries/{deliveryId}/retry',
      tags: ['integrações'],
      security,
      summary:
        'Reenvia agora uma entrega (editor+), com o mesmo X-Abt-Delivery e a mesma assinatura. Falhando de novo, fica como falha',
      request: { params: DeliveryParams },
      responses: { 200: json(Report, 'entrega atualizada'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, deliveryId } = c.req.valid('param');
      const [hook, d] = await Promise.all([
        repo.getEntity<Webhook>(user.accountId, 'webhook', id),
        repo.getWebhookDelivery(user.accountId, deliveryId),
      ]);
      if (!hook || !d || d.webhookId !== id) return c.json({ error: 'entrega não encontrada' }, 404);
      const u = await retryDelivery(repo, user.accountId, d, hook, { manual: true });
      return c.json(view({ ...d, ...u, updatedAt: new Date().toISOString() }), 200);
    },
  );
}
