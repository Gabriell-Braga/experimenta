import { createRoute, z } from '@hono/zod-openapi';
import {
  checkSecondFactor,
  forbid,
  hasRole,
  openSession,
  readMfaChallenge,
  secondFactorError,
} from '../auth';
import { verifyPassword } from '../crypto';
import { errors, ErrorSchema, json, security, type Api } from '../http';
import type { Mfa, Repo, User } from '../repo';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from '../totp';
import { publicUser, Session } from './team';

// Segurança de acesso (fase 16.5, D-073): login em duas etapas (TOTP) da pessoa, exigência por conta e
// sessões de login ativas ("sair de todos"). O segredo TOTP só sai da API na configuração, antes de confirmado.
export const SECURITY_PATHS = ['/me/*', '/sessions', '/sessions/*', '/account/security'];

const Code = z.string().trim().min(1).max(40);
const RecoveryOut = z.object({
  recoveryCodes: z.array(z.string()).openapi({ description: 'mostrados UMA vez; cada um vale um login' }),
});
const SessionOut = z
  .object({
    id: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    userAgent: z.string(),
    ip: z.string(),
    createdAt: z.string(),
    lastSeenAt: z.string(),
    expiresAt: z.string(),
    current: z.boolean(),
  })
  .openapi('LoginSession');
const Ok = json(z.object({ ok: z.boolean() }), 'ok');
const tooMany = json(ErrorSchema, 'muitas tentativas erradas (bloqueio de 15 min)');

/** Chave de API não é pessoa: não tem login em duas etapas nem sessões. */
const isPerson = (u: User) => !u.id.startsWith('apikey:');

async function freshRecovery(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = newRecoveryCodes();
  return { codes, hashes: await Promise.all(codes.map(hashRecoveryCode)) };
}

export function securityRoutes(app: Api, repo: Repo, secret: string) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/login/totp',
      tags: ['auth'],
      summary: '2ª etapa do login: código do app autenticador ou um código de recuperação',
      request: {
        body: json(z.object({ challenge: z.string().max(2000), code: Code }), 'desafio do login + código'),
      },
      responses: {
        200: json(Session, 'token JWT (12 h)'),
        401: json(ErrorSchema, 'desafio vencido ou código inválido'),
        429: tooMany,
      },
    }),
    async (c) => {
      const { challenge, code } = c.req.valid('json');
      const ch = await readMfaChallenge(challenge, secret).catch(() => null);
      const user = ch && (await repo.getUser(ch.accountId, ch.userId));
      if (!user) return c.json({ error: 'O login expirou: entre de novo.' }, 401);
      const r = await checkSecondFactor(repo, user, code);
      if (r !== 'ok') return secondFactorError(c, r);
      return c.json({ token: await openSession(repo, secret, c, user), user: publicUser(user) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/me/totp',
      tags: ['segurança'],
      security,
      summary: 'Estado do login em duas etapas da pessoa (nunca devolve o segredo)',
      responses: {
        200: json(
          z.object({
            enabled: z.boolean(),
            recoveryCodesLeft: z.number(),
            /** A conta ativa exige duas etapas. */
            required: z.boolean(),
          }),
          'estado',
        ),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      const m = me.mfa;
      return c.json(
        {
          enabled: !!m?.enabled,
          recoveryCodesLeft: m?.enabled ? m.recovery.length : 0,
          required: !!me.requireTotp,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/totp/setup',
      tags: ['segurança'],
      security,
      summary:
        'Começa a configuração: gera um segredo novo (ainda desligado) e devolve o segredo e a URI otpauth:// para o app',
      responses: {
        200: json(z.object({ secret: z.string(), uri: z.string() }), 'segredo em configuração'),
        409: json(ErrorSchema, 'já ativado'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      if (me.mfa?.enabled) return c.json({ error: 'O login em duas etapas já está ativado.' }, 409);
      const s = newTotpSecret();
      await repo.setMfa(me.id, {
        secret: s,
        enabled: false,
        recovery: [],
        lastStep: -1,
        failures: 0,
        lockedUntil: 0,
      });
      return c.json({ secret: s, uri: otpauthUri(s, me.email) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/totp/enable',
      tags: ['segurança'],
      security,
      summary: 'Confirma com um código do app e ativa; devolve os códigos de recuperação (uma vez)',
      request: { body: json(z.object({ code: Code }), 'código de 6 dígitos') },
      responses: {
        200: json(RecoveryOut, 'ativado'),
        400: json(ErrorSchema, 'código inválido ou configuração não iniciada'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      const m = me.mfa;
      if (!m || m.enabled) return c.json({ error: 'Comece a configuração de novo.' }, 400);
      const step = await verifyTotp(m.secret, c.req.valid('json').code);
      if (step === null)
        return c.json({ error: 'Código inválido: confira o relógio do celular e tente de novo.' }, 400);
      const { codes, hashes } = await freshRecovery();
      const next: Mfa = {
        ...m,
        enabled: true,
        recovery: hashes,
        lastStep: step,
        failures: 0,
        lockedUntil: 0,
      };
      await repo.setMfa(me.id, next);
      return c.json({ recoveryCodes: codes }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/totp/disable',
      tags: ['segurança'],
      security,
      summary: 'Desativa (senha + código). Recusado se a conta ativa exige duas etapas',
      request: {
        body: json(z.object({ password: z.string().min(1).max(200), code: Code }), 'senha e código'),
      },
      responses: {
        200: Ok,
        400: json(ErrorSchema, 'não ativado ou exigido pela conta'),
        401: json(ErrorSchema, 'senha ou código incorreto'),
        429: tooMany,
        403: errors[403],
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      if (!me.mfa?.enabled) return c.json({ error: 'O login em duas etapas não está ativado.' }, 400);
      if (me.requireTotp)
        return c.json({ error: 'Esta conta exige login em duas etapas: não dá para desativar.' }, 400);
      const { password, code } = c.req.valid('json');
      if (!(await verifyPassword(password, me.passwordHash)))
        return c.json({ error: 'Senha incorreta.' }, 401);
      const r = await checkSecondFactor(repo, me, code);
      if (r !== 'ok') return secondFactorError(c, r);
      await repo.setMfa(me.id, null);
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/totp/recovery-codes',
      tags: ['segurança'],
      security,
      summary: 'Gera novos códigos de recuperação (os anteriores param de valer). Pede um código',
      request: { body: json(z.object({ code: Code }), 'código do app') },
      responses: {
        200: json(RecoveryOut, 'novos códigos'),
        400: json(ErrorSchema, 'não ativado'),
        401: json(ErrorSchema, 'código inválido'),
        429: tooMany,
        403: errors[403],
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      if (!me.mfa?.enabled) return c.json({ error: 'O login em duas etapas não está ativado.' }, 400);
      const r = await checkSecondFactor(repo, me, c.req.valid('json').code);
      if (r !== 'ok') return secondFactorError(c, r);
      const { codes, hashes } = await freshRecovery();
      // Relê: checkSecondFactor acabou de gravar lastStep/recovery.
      const person = (await repo.getUser(me.accountId, me.id))!;
      await repo.setMfa(me.id, { ...person.mfa!, recovery: hashes });
      return c.json({ recoveryCodes: codes }, 200);
    },
  );

  // ---------- Sessões ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/sessions',
      tags: ['segurança'],
      security,
      summary: 'Sessões de login ativas da pessoa (em todas as contas); `current` = esta',
      responses: { 200: json(z.array(SessionOut), 'sessões'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      const names = new Map((await repo.listAccountsOf(me.id)).map((a) => [a.id, a.name]));
      return c.json(
        (await repo.listSessions(me.id)).map((s) => ({
          ...s,
          accountName: names.get(s.accountId) ?? '—',
          current: s.id === c.get('sid'),
        })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/sessions/{id}',
      tags: ['segurança'],
      security,
      summary: 'Encerra uma sessão (o token dela para de valer na hora). `current` = sair desta',
      request: {
        params: z.object({
          id: z
            .string()
            .max(100)
            .openapi({ param: { name: 'id', in: 'path' } }),
        }),
      },
      responses: { 204: { description: 'encerrada' }, ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      const { id } = c.req.valid('param');
      const sid = id === 'current' ? c.get('sid') : id;
      return sid && (await repo.deleteSession(me.id, sid))
        ? c.body(null, 204)
        : c.json({ error: 'sessão não encontrada' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/sessions',
      tags: ['segurança'],
      security,
      summary: 'Sair de todos os outros lugares: encerra todas as sessões da pessoa menos esta',
      responses: { 200: json(z.object({ revoked: z.number() }), 'quantas foram encerradas'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      const sid = c.get('sid');
      if (!isPerson(me) || !sid) return forbid(c);
      return c.json({ revoked: await repo.deleteOtherSessions(me.id, sid) }, 200);
    },
  );

  // ---------- Conta ----------
  const AccountSecurity = z.object({ requireTotp: z.boolean() }).openapi('AccountSecurity');
  app.openapi(
    createRoute({
      method: 'get',
      path: '/account/security',
      tags: ['segurança'],
      security,
      summary: 'Exigência de duas etapas na conta e quem ainda não ativou (só owner)',
      responses: {
        200: json(
          AccountSecurity.extend({
            withoutTotp: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
          }),
          'segurança da conta',
        ),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const members = await repo.listMembers(me.accountId);
      return c.json(
        {
          requireTotp: await repo.getRequireTotp(me.accountId),
          withoutTotp: members
            .filter((m) => !m.mfa?.enabled)
            .map((m) => ({ id: m.id, name: m.name, email: m.email })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/account/security',
      tags: ['segurança'],
      security,
      summary:
        'Liga/desliga a exigência de duas etapas (só owner, que precisa ter ativado). Quem não tiver ativado só consegue usar a tela de Segurança',
      request: { body: json(AccountSecurity, 'exigência') },
      responses: {
        200: json(AccountSecurity, 'salvo'),
        400: json(ErrorSchema, 'owner sem duas etapas'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner') || !isPerson(me)) return forbid(c);
      const { requireTotp } = c.req.valid('json');
      if (requireTotp && !me.mfa?.enabled)
        return c.json({ error: 'Ative o seu login em duas etapas antes de exigir da equipe.' }, 400);
      await repo.setRequireTotp(me.accountId, requireTotp);
      return c.json({ requireTotp }, 200);
    },
  );
}
