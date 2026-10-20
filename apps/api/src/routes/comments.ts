import { createRoute, z } from '@hono/zod-openapi';
import { forbid } from '../auth';
import { errors, ErrorSchema, json, security, type Api } from '../http';
import type { Comment, Repo, User } from '../repo';
import { dispatchNotice } from '../webhooks';
import { background } from './integrations';

// Comentários e @menções (fase 16.6, D-074) em experimentos (todos os tipos de teste e campanha), campanhas de
// engajamento (pop-ups, pesquisas) e ideias da Otimização por IA. Qualquer membro comenta, inclusive viewer;
// menção só de membro da conta (conferido aqui). Texto puro: o editor nunca o interpreta como HTML.

export const COMMENT_PATHS = ['/comments', '/comments/*'];
export const COMMENT_TARGETS = ['experiment', 'popup', 'survey', 'idea'] as const;
type Target = (typeof COMMENT_TARGETS)[number];

const Person = z.object({ id: z.string(), name: z.string() });
const CommentOut = z
  .object({
    id: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    targetName: z.string(),
    userId: z.string(),
    userName: z.string(),
    body: z.string(),
    mentions: z.array(Person),
    createdAt: z.string(),
  })
  .openapi('Comment');

const TargetQuery = z.object({
  targetType: z.enum(COMMENT_TARGETS),
  targetId: z.string().min(1).max(100),
});

/** Nome do alvo (copiado no comentário para a lista de menções), ou null se não existe nesta conta. */
async function targetName(repo: Repo, accountId: string, type: Target, id: string): Promise<string | null> {
  if (type === 'experiment') return (await repo.getExperiment(accountId, id))?.experiment.name ?? null;
  if (type === 'idea') {
    const [e] = await repo.listEntities<{ ideas?: { id: string; title: string }[] }>(accountId, 'ai-ideas');
    return e?.data.ideas?.find((i) => i.id === id)?.title ?? null;
  }
  return (await repo.getEntity(accountId, type, id))?.name ?? null;
}

const isApiKey = (u: User) => u.id.startsWith('apikey:');

export function commentRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/comments',
      tags: ['conta'],
      security,
      summary: 'Comentários de um experimento, campanha ou ideia (mais antigos primeiro)',
      request: { query: TargetQuery },
      responses: { 200: json(z.array(CommentOut), 'comentários'), ...errors },
    }),
    async (c) => {
      const { targetType, targetId } = c.req.valid('query');
      return c.json(await repo.listComments(c.get('user').accountId, targetType, targetId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/comments/mentions',
      tags: ['conta'],
      security,
      summary: 'Comentários que mencionam quem chama (50 mais recentes)',
      responses: { 200: json(z.array(CommentOut), 'menções'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      return c.json(isApiKey(user) ? [] : await repo.listMentions(user.accountId, user.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/comments',
      tags: ['conta'],
      security,
      summary:
        'Comenta (qualquer membro); `mentions` = ids de membros da conta, avisados no editor e por webhook',
      request: {
        body: json(
          TargetQuery.extend({
            body: z.string().trim().min(1).max(2000),
            mentions: z.array(z.string().max(100)).max(20).default([]),
          }),
          'comentário',
        ),
      },
      responses: { 201: json(CommentOut, 'comentário'), 400: json(ErrorSchema, 'inválido'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (isApiKey(user)) return forbid(c, 'só pessoas da conta comentam');
      const b = c.req.valid('json');
      const name = await targetName(repo, user.accountId, b.targetType, b.targetId);
      if (name === null) return c.json({ error: 'item não encontrado' }, 404);
      const members = new Map((await repo.listMembers(user.accountId)).map((m) => [m.id, m.name]));
      const ids = [...new Set(b.mentions)];
      if (ids.some((id) => !members.has(id)))
        return c.json({ error: 'só membros da conta podem ser mencionados' }, 400);
      const comment = await repo.addComment(user.accountId, {
        targetType: b.targetType,
        targetId: b.targetId,
        targetName: name,
        userId: user.id,
        userName: user.name,
        body: b.body,
        mentions: ids.map((id) => ({ id, name: members.get(id)! })),
      });
      const others = comment.mentions.filter((m) => m.id !== user.id);
      if (others.length)
        background(c, dispatchNotice(repo, user.accountId, 'mention', { mentioned: others, comment }));
      return c.json(comment, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/comments/{id}',
      tags: ['conta'],
      security,
      summary: 'Exclui um comentário (quem escreveu ou owner)',
      request: {
        params: z.object({
          id: z
            .string()
            .max(100)
            .openapi({ param: { name: 'id', in: 'path' } }),
        }),
      },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'excluído'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      const found: Comment | null = await repo.getComment(user.accountId, c.req.valid('param').id);
      if (!found) return c.json({ error: 'comentário não encontrado' }, 404);
      if (found.userId !== user.id && user.role !== 'owner')
        return forbid(c, 'só quem escreveu ou o owner exclui');
      await repo.deleteComment(user.accountId, found.id);
      return c.json({ ok: true }, 200);
    },
  );
}
