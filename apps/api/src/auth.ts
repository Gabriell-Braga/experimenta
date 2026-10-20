import type { Context, MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import { sha256hex } from './crypto';
import type { Person, Repo, Role, User } from './repo';
import { hashRecoveryCode, verifyTotp } from './totp';

export interface AuthVars {
  user: User;
  /** Sessão de login do token (ausente em chave de API). */
  sid?: string;
}

/** Duração da sessão de login (e do JWT). */
export const TOKEN_TTL_S = 12 * 60 * 60;

/** JWT de acesso: pessoa, conta ativa e sessão (`sid`, conferida no banco a cada requisição). */
export async function issueToken(user: User, sid: string, secret: string): Promise<string> {
  return sign(
    { sub: user.id, acc: user.accountId, sid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S },
    secret,
    'HS256',
  );
}

/** Abre uma sessão de login (aparelho e IP para a lista de sessões ativas) e devolve o JWT dela. */
export async function openSession(repo: Repo, secret: string, c: Context, user: User): Promise<string> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const sid = await repo.createSession(user.accountId, user.id, {
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 300),
    ip: ip.slice(0, 64),
    expiresAt: new Date(Date.now() + TOKEN_TTL_S * 1000),
  });
  return issueToken(user, sid, secret);
}

/** Erros seguidos da 2ª etapa até bloquear, e por quanto tempo. */
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MS = 15 * 60_000;

/**
 * Confere a 2ª etapa de quem tem TOTP ligado: código do app (uma vez por passo) ou código de recuperação
 * (uso único). 5 erros seguidos bloqueiam por 15 min, mesmo com o código certo.
 */
export async function checkSecondFactor(
  repo: Repo,
  person: Person,
  code: string,
  now = Date.now(),
): Promise<'ok' | 'invalid' | 'locked'> {
  const m = person.mfa;
  if (!m?.enabled) return 'invalid';
  if (m.lockedUntil > now) return 'locked';
  const step = await verifyTotp(m.secret, code, m.lastStep, now);
  const hash = step === null ? await hashRecoveryCode(code) : '';
  if (step !== null || m.recovery.includes(hash)) {
    await repo.setMfa(person.id, {
      ...m,
      lastStep: step ?? m.lastStep,
      recovery: m.recovery.filter((h) => h !== hash),
      failures: 0,
      lockedUntil: 0,
    });
    return 'ok';
  }
  const failures = m.failures + 1;
  const locked = failures >= MFA_MAX_FAILURES;
  await repo.setMfa(person.id, {
    ...m,
    failures: locked ? 0 : failures,
    lockedUntil: locked ? now + MFA_LOCK_MS : 0,
  });
  return locked ? 'locked' : 'invalid';
}

/** Resposta de 2ª etapa recusada (401 código errado, 429 bloqueado). */
export const secondFactorError = (c: Context, r: 'invalid' | 'locked') =>
  r === 'locked'
    ? c.json({ error: 'Muitas tentativas erradas: aguarde 15 minutos.' }, 429)
    : c.json({ error: 'Código inválido.' }, 401);

/** Desafio da 2ª etapa: senha conferida, falta o código. Vale 5 min e não abre nenhuma rota privada. */
export const MFA_TTL_S = 5 * 60;
export const issueMfaChallenge = (user: User, secret: string) =>
  sign(
    { sub: user.id, acc: user.accountId, typ: 'mfa', exp: Math.floor(Date.now() / 1000) + MFA_TTL_S },
    secret,
    'HS256',
  );
export async function readMfaChallenge(token: string, secret: string) {
  const p = (await verify(token, secret, 'HS256')) as { sub?: string; acc?: string; typ?: string };
  if (p.typ !== 'mfa' || !p.sub || !p.acc) throw new Error('desafio inválido');
  return { userId: p.sub, accountId: p.acc };
}

/** Pessoa sem TOTP numa conta que exige: só pode configurar, ver/encerrar sessões e trocar de conta. */
const TOTP_SETUP_PATHS = /^\/(me(\/.*)?|sessions(\/.*)?|accounts\/[^/]+\/switch)$/;
export const TOTP_REQUIRED = 'totp_required';

/**
 * Bearer JWT → usuário recarregado do banco a cada requisição (papel/permissão sempre atuais,
 * usuário removido perde acesso na hora). A conta vem do token, nunca do corpo da requisição.
 * A sessão do token (`sid`) também é conferida: encerrada ou vencida, o token para de valer na hora.
 */
export function requireAuth(repo: Repo, secret: string): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let user: User | undefined;
    try {
      if (token.startsWith(API_KEY_PREFIX)) user = await userFromApiKey(repo, token);
      else {
        const p = (await verify(token, secret, 'HS256')) as { sub: string; acc: string; sid?: string };
        if (typeof p.sid !== 'string' || !(await repo.touchSession(p.sub, p.sid)))
          throw new Error('sessão encerrada');
        user = await repo.getUser(p.acc, p.sub);
        c.set('sid', p.sid);
      }
      if (!user) throw new Error('usuário inexistente');
      c.set('user', user);
    } catch {
      return c.json({ error: 'não autenticado' }, 401);
    }
    if (user.requireTotp && !user.mfa?.enabled && !TOTP_SETUP_PATHS.test(c.req.path))
      return c.json(
        {
          error: 'Esta conta exige login em duas etapas: ative em Segurança para continuar.',
          code: TOTP_REQUIRED,
        },
        403,
      );
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
    mfa: null,
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
