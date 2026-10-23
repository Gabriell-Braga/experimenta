import type { MiddlewareHandler } from 'hono';
import { readMfaChallenge } from './auth';
import type { Repo } from './repo';

// Proteção contra força bruta no login (20.6, D-100): falhas contadas por IP e por e-mail em POST /auth/login e
// por IP em POST /auth/login/totp (o TOTP já tem bloqueio por pessoa gravado no banco: 5 erros → 15 min,
// auth.ts#checkSecondFactor). Atingiu o limite: 429 até a janela acabar. Falhas e bloqueios vão para o
// histórico de atividades da conta da pessoa (e-mail desconhecido não tem conta onde registrar).
//
// ponytail: contagem em memória por isolate do Worker (cada isolate conta separado e zera ao reciclar), então o
// teto real é LIMIT × isolates ativos. KV não serve (1000 escritas/dia no plano grátis, e cada falha seria uma
// escrita) e D1 pediria tabela nova; se aparecer ataque distribuído de verdade, usar o Rate Limiting binding
// da Cloudflare ou uma tabela no D1.

export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Falhas por e-mail na janela antes do bloqueio. */
export const EMAIL_LIMIT = 5;
/** Falhas por IP na janela (vários e-mails do mesmo IP; NAT de escritório cabe folgado). */
export const IP_LIMIT = 20;
const MAX_KEYS = 10_000;

export function createLimiter(max: number, windowMs = LOGIN_WINDOW_MS, now = Date.now) {
  /** n = falhas na janela que termina em `until` (ao bater o limite, `until` vira o fim do bloqueio). */
  const hits = new Map<string, { n: number; until: number }>();
  return {
    /** Segundos até liberar (0 = liberado). */
    blocked(key: string): number {
      const h = hits.get(key);
      const t = now();
      return h && h.n >= max && h.until > t ? Math.ceil((h.until - t) / 1000) : 0;
    },
    /** Conta uma falha; true = esta falha bloqueou. */
    fail(key: string): boolean {
      const t = now();
      let h = hits.get(key);
      if (!h || h.until <= t) {
        if (hits.size >= MAX_KEYS) for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
        // Ainda cheio de chaves vivas: esquece a mais antiga (Map guarda a ordem de inserção).
        if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value!);
        h = { n: 0, until: t + windowMs };
        hits.set(key, h);
      }
      h.n++;
      if (h.n === max) {
        h.until = t + windowMs;
        return true;
      }
      return false;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}

export const clientIp = (header: (n: string) => string | undefined) =>
  header('cf-connecting-ip') ?? header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

export function loginGuard(repo: Repo, secret: string): MiddlewareHandler {
  const byIp = createLimiter(IP_LIMIT);
  const byEmail = createLimiter(EMAIL_LIMIT);
  return async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const totp = c.req.path.endsWith('/totp');
    const raw: unknown = await c.req.json().catch(() => null);
    const body = (raw && typeof raw === 'object' ? raw : {}) as { email?: unknown; challenge?: unknown };
    const ip = `ip:${clientIp((n) => c.req.header(n))}`;
    const email = !totp && typeof body.email === 'string' ? `e:${body.email.trim().toLowerCase()}` : '';
    const wait = Math.max(byIp.blocked(ip), email ? byEmail.blocked(email) : 0);
    if (wait) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'Muitas tentativas erradas: aguarde 15 minutos.' }, 429);
    }
    await next();
    const status = c.res.status;
    if (status === 200 && email) byEmail.reset(email);
    if (status !== 401) return;
    let locked = byIp.fail(ip);
    if (email) locked = byEmail.fail(email) || locked;
    // Quem errou: a pessoa do e-mail (na conta padrão) ou a do desafio da 2ª etapa.
    const person = totp
      ? await readMfaChallenge(String(body.challenge ?? ''), secret)
          .then((ch) => repo.getUser(ch.accountId, ch.userId))
          .catch(() => undefined)
      : email
        ? await repo.findUserByEmail(email.slice(2))
        : undefined;
    if (!person) return;
    await repo
      .logActivity(person.accountId, {
        userId: person.id,
        userName: person.name,
        action: totp ? 'totp_failed' : 'login_failed',
        targetType: 'security',
        targetId: person.id,
        targetName: person.name,
        detail: `${locked ? 'bloqueado por 15 min · ' : ''}IP ${ip.slice(3) || '?'}`.slice(0, 200),
      })
      .catch((e) => console.error('auditoria:', e));
  };
}
