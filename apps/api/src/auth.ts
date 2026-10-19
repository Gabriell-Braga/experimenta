import type { Context, MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import { sha256hex } from './crypto';
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
      const user = token.startsWith(API_KEY_PREFIX)
        ? await userFromApiKey(repo, token)
        : await (async () => {
            const payload = (await verify(token, secret, 'HS256')) as { sub: string; acc: string };
            return repo.getUser(payload.acc, payload.sub);
          })();
      if (!user) throw new Error('usuário inexistente');
      c.set('user', user);
    } catch {
      return c.json({ error: 'não autenticado' }, 401);
    }
    await next();
  };
}

/** Chave de API: `abk_<conta>.<segredo>`. Só o hash SHA-256 fica guardado (entidade `apikey`). */
export const API_KEY_PREFIX = 'abk_';
export interface ApiKeyData {
  hash: string;
  /** Início visível da chave (para reconhecer na lista). */
  prefix: string;
  role: 'viewer' | 'editor';
}

/** Usuário "de sistema" da chave: papel da chave, nunca owner nem permissão de publicar JS. */
async function userFromApiKey(repo: Repo, token: string): Promise<User | undefined> {
  const accountId = token.slice(API_KEY_PREFIX.length).split('.')[0] ?? '';
  if (!accountId) return undefined;
  const hash = await sha256hex(token);
  const key = (await repo.listEntities<ApiKeyData>(accountId, 'apikey')).find((k) => k.data.hash === hash);
  if (!key) return undefined;
  return {
    id: `apikey:${key.id}`,
    accountId,
    email: 'api',
    name: key.name,
    role: key.data.role,
    canPublishJs: false,
    passwordHash: '',
    createdAt: new Date(key.createdAt),
  };
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export const hasRole = (user: User, min: Role) => RANK[user.role] >= RANK[min];

/** Pode publicar customJS: owner sempre; demais só com a permissão explícita. */
export const canPublishJs = (user: User) => user.role === 'owner' || user.canPublishJs;

export function forbid(c: Context, msg = 'sem permissão') {
  return c.json({ error: msg }, 403);
}
