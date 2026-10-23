import { createRoute, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import { NameSchema } from '@abtest/shared';
import { openSession, sessionBody } from '../auth';
import { clientIp, createLimiter } from '../login-guard';
import { sha256hex } from '../crypto';
import { ErrorSchema, json, type Api } from '../http';
import type { Repo } from '../repo';
import { publicUser, Session } from './team';

// Criar conta (cadastro público) e recuperar senha (tarefa 20.4, D-099).

/** Política de senha do cadastro e da troca por recuperação. */
export const NewPassword = z.string().min(10, 'senha: mínimo de 10 caracteres').max(200);

/** Envio de e-mail. Sem provedor configurado (ver docs/PENDENCIAS.md) só registra no log. */
export type SendMail = (to: string, subject: string, text: string) => Promise<void>;
export const logMail: SendMail = async (to, subject, text) =>
  console.info(`[e-mail sem provedor] para ${to}: ${subject}\n${text}`);

/**
 * Limite por IP e rota: cada pedido conta (o limitador do login, login-guard.ts, mesma ressalva de memória por
 * isolate do Worker).
 */
export function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  const limiter = createLimiter(max, windowMs);
  return async (c, next) => {
    const key = `${c.req.path}|${clientIp((n) => c.req.header(n))}`;
    const wait = limiter.blocked(key);
    if (wait) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'Muitas tentativas: aguarde alguns minutos e tente de novo.' }, 429);
    }
    limiter.fail(key);
    await next();
  };
}

/** Token de recuperação: 30 min, ligado ao hash da senha atual (trocou a senha, o token morre: uso único). */
export const RESET_TTL_S = 30 * 60;
const passwordTag = async (passwordHash: string) => (await sha256hex(passwordHash)).slice(0, 32);
export async function issueResetToken(email: string, passwordHash: string, secret: string) {
  return sign(
    {
      typ: 'reset',
      em: email.toLowerCase(),
      ph: await passwordTag(passwordHash),
      exp: Math.floor(Date.now() / 1000) + RESET_TTL_S,
    },
    secret,
    'HS256',
  );
}

const FORGOT_MSG =
  'Se este e-mail tiver login, enviamos um link para criar uma senha nova (vale 30 minutos).';
const tooMany = json(ErrorSchema, 'muitas tentativas');

export function signupRoutes(
  app: Api,
  repo: Repo,
  secret: string,
  editorOrigins: string[],
  sendMail: SendMail = logMail,
) {
  app.use('/auth/signup', rateLimit(5, 60 * 60_000));
  app.use('/auth/password/forgot', rateLimit(5, 15 * 60_000));
  app.use('/auth/password/reset', rateLimit(10, 15 * 60_000));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/signup',
      tags: ['auth'],
      summary: 'Cria login + workspace novo (owner) com o primeiro projeto e já entra',
      request: {
        body: json(
          z.object({
            name: NameSchema,
            email: z.string().email().max(200),
            password: NewPassword,
            workspace: NameSchema,
            siteUrl: z.string().url().max(2000),
          }),
          'pessoa, workspace e site',
        ),
      },
      responses: {
        201: json(Session, 'conta criada e sessão aberta'),
        400: json(ErrorSchema, 'inválido'),
        409: json(ErrorSchema, 'e-mail já tem login'),
        429: tooMany,
      },
    }),
    async (c) => {
      const { name, email, password, workspace, siteUrl } = c.req.valid('json');
      if (!/^https?:/.test(siteUrl)) return c.json({ error: 'siteUrl: use http:// ou https://' }, 400);
      // ponytail: revela que o e-mail já tem login (sem serviço de e-mail não há confirmação); o limite por IP segura a varredura.
      const taken = 'Este e-mail já tem login: entre ou use "Esqueci minha senha".';
      if (await repo.findUserByEmail(email)) return c.json({ error: taken }, 409);
      const acc = await repo.createAccount(workspace);
      try {
        await repo.createUser(acc.id, { email, name, password, role: 'owner', canPublishJs: true });
      } catch {
        return c.json({ error: taken }, 409); // corrida: dois cadastros com o mesmo e-mail
      }
      await repo.createProject(acc.id, { name: workspace, siteUrl });
      // Consentimento: sem escolha salva o workspace já publica esperando (padrão, D-099); a Instalação pede a escolha.
      const person = (await repo.findUserByEmail(email))!;
      const user = (await repo.getUser(acc.id, person.id))!;
      return c.json(sessionBody(c, await openSession(repo, secret, c, user), publicUser(user)), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/password/forgot',
      tags: ['auth'],
      summary: 'Pede o link de recuperação. Resposta sempre igual (não revela se o e-mail tem login)',
      request: { body: json(z.object({ email: z.string().email().max(200) }), 'e-mail do login') },
      responses: { 200: json(z.object({ message: z.string() }), 'pedido recebido'), 429: tooMany },
    }),
    async (c) => {
      const { email } = c.req.valid('json');
      const person = await repo.findUserByEmail(email);
      if (person) {
        const origin = c.req.header('origin') ?? '';
        const base = editorOrigins.includes(origin) ? origin : editorOrigins[0];
        const token = await issueResetToken(person.email, person.passwordHash, secret);
        await sendMail(
          person.email,
          'Experimenta: criar senha nova',
          `Para criar uma senha nova, abra (vale 30 minutos, uma vez):\n${base}/?reset=${encodeURIComponent(token)}\n\nNão pediu? Ignore este e-mail.`,
        ).catch((e) => console.error('[e-mail]', e));
      }
      return c.json({ message: FORGOT_MSG }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/password/reset',
      tags: ['auth'],
      summary: 'Troca a senha com o token do link e encerra todas as sessões da pessoa',
      request: {
        body: json(z.object({ token: z.string().max(2000), password: NewPassword }), 'token e senha nova'),
      },
      responses: {
        200: json(z.object({ ok: z.boolean() }), 'senha trocada'),
        400: json(ErrorSchema, 'link inválido, vencido ou já usado'),
        429: tooMany,
      },
    }),
    async (c) => {
      const { token, password } = c.req.valid('json');
      const p = (await verify(token, secret, 'HS256').catch(() => null)) as {
        typ?: string;
        em?: string;
        ph?: string;
      } | null;
      const person = p?.typ === 'reset' && p.em ? await repo.findUserByEmail(p.em) : undefined;
      if (!person || p?.ph !== (await passwordTag(person.passwordHash)))
        return c.json({ error: 'Link inválido, vencido ou já usado: peça outro.' }, 400);
      await repo.setPassword(person.id, password);
      await repo.deleteOtherSessions(person.id, '');
      return c.json({ ok: true }, 200);
    },
  );
}
