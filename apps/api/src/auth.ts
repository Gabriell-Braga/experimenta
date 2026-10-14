import type { Context, MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { Repo, Role, User } from './repo';

export interface AuthVars {
  user: User;
}

export const TOKEN_TTL_S = 12 * 60 * 60;

export async function issueToken(user: User, secret: string): Promise<string> {
  return sign(
    { sub: user.id, acc: user.accountId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S },
    secret,
    'HS256',
  );
}

/**
 * Bearer JWT → usuário recarregado do banco a cada requisição (papel/permissão sempre atuais,
 * usuário removido perde acesso na hora). A conta vem do token, nunca do corpo da requisição.
 */
export function requireAuth(repo: Repo, secret: string): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const payload = (await verify(token, secret, 'HS256')) as { sub: string; acc: string };
      const user = await repo.getUser(payload.acc, payload.sub);
      if (!user) throw new Error('usuário inexistente');
      c.set('user', user);
    } catch {
      return c.json({ error: 'não autenticado' }, 401);
    }
    await next();
  };
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export const hasRole = (user: User, min: Role) => RANK[user.role] >= RANK[min];

/** Pode publicar customJS: owner sempre; demais só com a permissão explícita. */
export const canPublishJs = (user: User) => user.role === 'owner' || user.canPublishJs;

export function forbid(c: Context, msg = 'sem permissão') {
  return c.json({ error: msg }, 403);
}
