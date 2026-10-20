import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { NameSchema } from '@abtest/shared';
import {
  checkSecondFactor,
  forbid,
  hasRole,
  issueMfaChallenge,
  issueToken,
  openSession,
  secondFactorError,
  type AuthVars,
} from '../auth';
import { randomToken, sha256hex, verifyPassword } from '../crypto';
import { errors, ErrorSchema, json, security, type Api } from '../http';
import type { Entity, Repo, Role, User } from '../repo';

// Login, contas da pessoa (multi-conta), membros e convites (tarefa 16.2).
export const TEAM_PATHS = [
  '/me',
  '/accounts',
  '/accounts/*',
  '/members',
  '/members/*',
  '/invites',
  '/invites/*',
];

const RoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const UserOut = z
  .object({
    id: z.string(),
    accountId: z.string(),
    email: z.string(),
    name: z.string(),
    role: RoleSchema,
    canPublishJs: z.boolean(),
  })
  .openapi('User');
const AccountOut = z.object({ id: z.string(), name: z.string(), role: RoleSchema }).openapi('AccountRef');
const MeOut = UserOut.extend({
  accounts: z.array(AccountOut),
  totpEnabled: z.boolean(),
  /** A conta ativa exige duas etapas e a pessoa ainda não ativou: só a tela de Segurança funciona. */
  totpRequired: z.boolean(),
}).openapi('Me');
export const Session = z.object({ token: z.string(), user: UserOut }).openapi('Session');
const MfaChallenge = z
  .object({
    mfa: z.literal('totp'),
    challenge: z.string().openapi({ description: 'enviar em POST /auth/login/totp com o código (5 min)' }),
  })
  .openapi('MfaChallenge');
const Password = z.string().min(8, 'mínimo de 8 caracteres').max(200);
const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });
const TokenParam = z.object({
  token: z
    .string()
    .max(300)
    .openapi({ param: { name: 'token', in: 'path' } }),
});
const Access = z.object({ role: RoleSchema, canPublishJs: z.boolean().default(false) });

export const publicUser = (u: User) => ({
  id: u.id,
  accountId: u.accountId,
  email: u.email,
  name: u.name,
  role: u.role,
  canPublishJs: u.canPublishJs,
});

/** Convite: `inv_<conta>.<segredo>`, só o hash fica guardado (entidade `invite`, como as chaves de API). */
export const INVITE_PREFIX = 'inv_';
export const INVITE_TTL_MS = 7 * 86_400_000;
export interface InviteData {
  email: string;
  role: Role;
  canPublishJs: boolean;
  hash: string;
  expiresAt: string;
}

async function findInvite(repo: Repo, token: string) {
  if (!token.startsWith(INVITE_PREFIX)) return undefined;
  const accountId = token.slice(INVITE_PREFIX.length).split('.')[0] ?? '';
  const accountName = accountId && (await repo.getAccountName(accountId));
  if (!accountName) return undefined;
  const hash = await sha256hex(token);
  const inv = (await repo.listEntities<InviteData>(accountId, 'invite')).find((i) => i.data.hash === hash);
  if (!inv || Date.parse(inv.data.expiresAt) < Date.now()) return undefined;
  return { accountId, accountName, invite: inv };
}

const inviteOut = (i: Entity<InviteData>) => ({
  id: i.id,
  email: i.data.email,
  role: i.data.role,
  canPublishJs: i.data.canPublishJs,
  expiresAt: i.data.expiresAt,
  createdAt: i.createdAt,
});

/** Chave de API não é pessoa: não troca de conta, não cria conta nem gerencia equipe. */
const isPerson = (u: User) => !u.id.startsWith('apikey:');

/** Algum outro owner continua na conta se `userId` deixar de ser owner? */
const keepsAnOwner = async (repo: Repo, accountId: string, userId: string) =>
  (await repo.listMembers(accountId)).some((m) => m.role === 'owner' && m.id !== userId);

export function teamRoutes(app: Api, repo: Repo, secret: string) {
  const session = async (c: Context, u: User) => ({
    token: await openSession(repo, secret, c, u),
    user: publicUser(u),
  });
  /** Troca de conta / conta nova: a mesma sessão passa para a outra conta (novo token, mesmo `sid`). */
  const moved = async (c: Context<{ Variables: AuthVars }>, u: User) => {
    const sid = c.get('sid');
    if (!sid || !(await repo.moveSession(u.id, sid, u.accountId))) return null;
    return { token: await issueToken(u, sid, secret), user: publicUser(u) };
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/login',
      tags: ['auth'],
      request: {
        body: json(
          z.object({
            email: z.string().email(),
            password: z.string().min(1),
            accountId: z
              .string()
              .max(100)
              .optional()
              .openapi({ description: 'conta preferida (a última usada)' }),
          }),
          'credenciais',
        ),
      },
      responses: {
        200: json(
          z.union([Session, MfaChallenge]),
          'token JWT (12 h) da conta escolhida, ou o desafio da 2ª etapa para quem tem TOTP',
        ),
        401: json(ErrorSchema, 'credenciais inválidas'),
      },
    }),
    async (c) => {
      const { email, password, accountId } = c.req.valid('json');
      const person = await repo.findUserByEmail(email);
      if (!person || !(await verifyPassword(password, person.passwordHash)))
        return c.json({ error: 'e-mail ou senha inválidos' }, 401);
      // Conta: a pedida (se for membro), senão a padrão, senão a mais antiga.
      const ids = (await repo.listAccountsOf(person.id)).map((a) => a.id);
      const acc = [accountId, person.accountId, ids[0]].find((id) => id && ids.includes(id));
      const user = acc && (await repo.getUser(acc, person.id));
      if (!user) return c.json({ error: 'e-mail ou senha inválidos' }, 401);
      if (user.mfa?.enabled)
        return c.json({ mfa: 'totp' as const, challenge: await issueMfaChallenge(user, secret) }, 200);
      return c.json(await session(c, user), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/me',
      tags: ['auth'],
      security,
      summary: 'Usuário logado na conta ativa, com as contas de que é membro',
      responses: { 200: json(MeOut, 'usuário logado'), 401: errors[401] },
    }),
    async (c) => {
      const user = c.get('user');
      const totpEnabled = !!user.mfa?.enabled;
      return c.json(
        {
          ...publicUser(user),
          accounts: await repo.listAccountsOf(user.id),
          totpEnabled,
          totpRequired: !!user.requireTotp && !totpEnabled,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/accounts',
      tags: ['contas'],
      security,
      summary: 'Cria uma conta nova (com o primeiro projeto) e devolve o token já nela, como owner',
      request: {
        body: json(z.object({ name: NameSchema, siteUrl: z.string().url().max(2000) }), 'nova conta'),
      },
      responses: { 201: json(Session, 'conta criada'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!isPerson(me)) return forbid(c);
      const { name, siteUrl } = c.req.valid('json');
      // ponytail: sem limite de contas por pessoa nem transação entre os três inserts; limitar quando houver cadastro público.
      const acc = await repo.createAccount(name);
      await repo.addMember(acc.id, me.id, { role: 'owner', canPublishJs: true });
      await repo.createProject(acc.id, { name, siteUrl });
      const s = await moved(c, (await repo.getUser(acc.id, me.id))!);
      return s ? c.json(s, 201) : c.json({ error: 'não autenticado' }, 401);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/accounts/{id}/switch',
      tags: ['contas'],
      security,
      summary: 'Troca para outra conta de que a pessoa é membro (novo token)',
      request: { params: Id },
      responses: { 200: json(Session, 'token da conta'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      const user = isPerson(me) ? await repo.getUser(c.req.valid('param').id, me.id) : undefined;
      const s = user && (await moved(c, user));
      return s ? c.json(s, 200) : c.json({ error: 'não é membro dessa conta' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/members',
      tags: ['contas'],
      security,
      summary: 'Membros da conta e seus papéis',
      responses: { 200: json(z.array(UserOut.extend({ createdAt: z.string() })), 'membros'), ...errors },
    }),
    async (c) =>
      c.json(
        (await repo.listMembers(c.get('user').accountId)).map((m) => ({
          ...publicUser(m),
          createdAt: m.createdAt.toISOString(),
        })),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/members/{id}',
      tags: ['contas'],
      security,
      summary: 'Muda o papel de um membro (só owner; a conta nunca fica sem owner)',
      request: { params: Id, body: json(Access, 'papel') },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'salvo'), 400: errors[404], ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const { id } = c.req.valid('param');
      const access = c.req.valid('json');
      if (access.role !== 'owner' && !(await keepsAnOwner(repo, me.accountId, id)))
        return c.json({ error: 'a conta precisa de pelo menos um owner' }, 400);
      return (await repo.updateMember(me.accountId, id, access))
        ? c.json({ ok: true }, 200)
        : c.json({ error: 'membro não encontrado' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/members/{id}',
      tags: ['contas'],
      security,
      summary: 'Remove um membro (owner) ou sai da conta (o próprio). A conta nunca fica sem owner',
      request: { params: Id },
      responses: { 204: { description: 'removido' }, 400: errors[404], ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      const { id } = c.req.valid('param');
      if (!isPerson(me) || (id !== me.id && !hasRole(me, 'owner'))) return forbid(c);
      if (!(await keepsAnOwner(repo, me.accountId, id)))
        return c.json({ error: 'a conta precisa de pelo menos um owner' }, 400);
      return (await repo.removeMember(me.accountId, id))
        ? c.body(null, 204)
        : c.json({ error: 'membro não encontrado' }, 404);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/invites',
      tags: ['contas'],
      security,
      summary: 'Convites pendentes (só owner)',
      responses: { 200: json(z.any(), 'convites'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      return c.json((await repo.listEntities<InviteData>(me.accountId, 'invite')).map(inviteOut), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/invites',
      tags: ['contas'],
      security,
      summary:
        'Convida por e-mail com um papel (só owner). Devolve o token UMA vez: o link é enviado por quem convidou (sem serviço de e-mail)',
      request: {
        body: json(Access.extend({ email: z.string().trim().toLowerCase().email().max(200) }), 'convite'),
      },
      responses: {
        201: json(z.object({ id: z.string(), token: z.string(), expiresAt: z.string() }), 'criado'),
        409: json(ErrorSchema, 'já é membro'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner') || !isPerson(me)) return forbid(c);
      const { email, role, canPublishJs } = c.req.valid('json');
      if ((await repo.listMembers(me.accountId)).some((m) => m.email === email))
        return c.json({ error: 'essa pessoa já é membro da conta' }, 409);
      // Novo convite para o mesmo e-mail substitui o anterior (o link antigo para de valer).
      for (const old of await repo.listEntities<InviteData>(me.accountId, 'invite'))
        if (old.data.email === email) await repo.deleteEntity(me.accountId, 'invite', old.id);
      const token = `${INVITE_PREFIX}${me.accountId}.${randomToken(24)}`;
      const data: InviteData = {
        email,
        role,
        canPublishJs: role !== 'owner' && canPublishJs,
        hash: await sha256hex(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      };
      const id = await repo.saveEntity(me.accountId, { kind: 'invite', name: email, data, userId: me.id });
      return c.json({ id, token, expiresAt: data.expiresAt }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/invites/{id}',
      tags: ['contas'],
      security,
      summary: 'Cancela um convite (o link para de valer na hora)',
      request: { params: Id },
      responses: { 204: { description: 'cancelado' }, ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      return (await repo.deleteEntity(me.accountId, 'invite', c.req.valid('param').id))
        ? c.body(null, 204)
        : c.json({ error: 'não encontrado' }, 404);
    },
  );

  // ---------- Públicas: quem recebeu o link ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/auth/invites/{token}',
      tags: ['auth'],
      summary: 'Dados do convite (conta, e-mail, papel) e se o e-mail já tem login',
      request: { params: TokenParam },
      responses: {
        200: json(
          z.object({
            accountName: z.string(),
            email: z.string(),
            role: RoleSchema,
            hasUser: z.boolean(),
            /** O login existente tem duas etapas: o aceite pede o código. */
            hasTotp: z.boolean(),
          }),
          'convite',
        ),
        404: errors[404],
      },
    }),
    async (c) => {
      const found = await findInvite(repo, c.req.valid('param').token);
      if (!found) return c.json({ error: 'convite inválido ou expirado' }, 404);
      const { data } = found.invite;
      const person = await repo.findUserByEmail(data.email);
      return c.json(
        {
          accountName: found.accountName,
          email: data.email,
          role: data.role,
          hasUser: !!person,
          hasTotp: !!person?.mfa?.enabled,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/invites/{token}/accept',
      tags: ['auth'],
      summary:
        'Aceita o convite. E-mail com login: confirma a senha e entra na conta. E-mail novo: cria o login com nome e senha',
      request: {
        params: TokenParam,
        body: json(
          z.object({
            password: Password,
            name: NameSchema.optional(),
            code: z.string().max(40).optional().openapi({ description: '2ª etapa, se o login tiver TOTP' }),
          }),
          'senha (e nome, se novo; código, se tiver duas etapas)',
        ),
      },
      responses: {
        200: json(Session, 'token já na conta do convite'),
        400: errors[404],
        401: json(ErrorSchema, 'senha ou código incorreto'),
        404: errors[404],
        429: json(ErrorSchema, 'muitas tentativas erradas na 2ª etapa'),
      },
    }),
    async (c) => {
      const found = await findInvite(repo, c.req.valid('param').token);
      if (!found) return c.json({ error: 'convite inválido ou expirado' }, 404);
      const { accountId, invite } = found;
      const { email, role, canPublishJs } = invite.data;
      const { password, name, code } = c.req.valid('json');
      const person = await repo.findUserByEmail(email);
      if (person) {
        if (!(await verifyPassword(password, person.passwordHash)))
          return c.json({ error: 'senha incorreta' }, 401);
        if (person.mfa?.enabled) {
          const r = await checkSecondFactor(repo, person, code ?? '');
          if (r !== 'ok') return secondFactorError(c, r);
        }
        await repo.addMember(accountId, person.id, { role, canPublishJs });
      } else {
        if (!name) return c.json({ error: 'name: obrigatório' }, 400);
        try {
          await repo.createUser(accountId, { email, name, password, role, canPublishJs });
        } catch {
          return c.json({ error: 'convite já usado' }, 400); // corrida: dois aceites ao mesmo tempo
        }
      }
      await repo.deleteEntity(accountId, 'invite', invite.id);
      const user = (await repo.getUser(accountId, (await repo.findUserByEmail(email))!.id))!;
      return c.json(await session(c, user), 200);
    },
  );
}
