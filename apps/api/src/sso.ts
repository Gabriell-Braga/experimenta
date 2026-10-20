import { createRoute, z } from '@hono/zod-openapi';
import { sign, verify } from 'hono/jwt';
import type { Context } from 'hono';
import { forbid, hasRole, openSession, type AuthVars } from './auth';
import { errors, ErrorSchema, json, security, type Api } from './http';
import type { Repo } from './repo';

// Base do SSO por conta (fase 16.5, D-073): configuração (OIDC ou SAML) guardada como entidade interna `sso`
// e o fluxo start → IdP → callback → sessão, com o protocolo plugado por `SsoProvider`. Nenhum provedor vem
// implementado ainda: sem ele a configuração só pode ser salva desligada. Ver D-073 para o que falta.

export const SSO_KIND = 'sso';
const SECRET_MASK = 'clientSecret';

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'domínio inválido');
export const SsoConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    protocol: z.enum(['oidc', 'saml']),
    /** Domínios de e-mail da empresa (para a descoberta no login, ainda não feita). */
    domains: z.array(domain).max(20).default([]),
    /** OIDC: emissor (descoberta em `/.well-known/openid-configuration`), client id e segredo. */
    issuer: z.string().url().max(500).optional(),
    clientId: z.string().trim().max(300).optional(),
    clientSecret: z.string().max(500).optional().openapi({ description: 'só escrita: nunca volta na API' }),
    /** SAML: URL de login do IdP, entity id e certificado (PEM) que assina as respostas. */
    ssoUrl: z.string().url().max(2000).optional(),
    idpEntityId: z.string().trim().max(500).optional(),
    idpCert: z.string().max(10_000).optional(),
  })
  .openapi('SsoConfig');
export type SsoConfig = z.infer<typeof SsoConfigSchema>;

/** Ponto de extensão: um protocolo (OIDC ou SAML) implementa estes dois passos. */
export interface SsoProvider {
  /** URL do IdP para onde o navegador vai. `state` precisa voltar intacto no callback. */
  authorize(cfg: SsoConfig, p: { callbackUrl: string; state: string }): Promise<string>;
  /** Valida a resposta do IdP (query do OIDC ou formulário do SAML) e devolve quem entrou. */
  verify(
    cfg: SsoConfig,
    p: { callbackUrl: string; query: Record<string, string>; form: Record<string, string> },
  ): Promise<{ email: string }>;
}
export type SsoProviders = Partial<Record<SsoConfig['protocol'], SsoProvider>>;

const STATE_TTL_S = 10 * 60;
const AccParam = z.object({
  accountId: z
    .string()
    .max(100)
    .openapi({ param: { name: 'accountId', in: 'path' } }),
});

async function loadConfig(repo: Repo, accountId: string) {
  const [e] = await repo.listEntities<SsoConfig>(accountId, SSO_KIND);
  return e;
}

export function ssoRoutes(
  app: Api,
  repo: Repo,
  secret: string,
  providers: SsoProviders,
  editorOrigins: string[],
) {
  const available = Object.keys(providers) as SsoConfig['protocol'][];
  const ConfigOut = z.object({
    config: SsoConfigSchema.nullable(),
    hasClientSecret: z.boolean(),
    available: z.array(z.enum(['oidc', 'saml'])),
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/account/sso',
      tags: ['segurança'],
      security,
      summary: 'Configuração de SSO da conta (só owner; o segredo do cliente nunca volta)',
      responses: { 200: json(ConfigOut, 'configuração'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const e = await loadConfig(repo, me.accountId);
      const { [SECRET_MASK]: s, ...config } = e?.data ?? ({} as SsoConfig);
      return c.json({ config: e ? (config as SsoConfig) : null, hasClientSecret: !!s, available }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/account/sso',
      tags: ['segurança'],
      security,
      summary:
        'Salva a configuração de SSO (só owner). Segredo omitido mantém o anterior. Ligar exige o protocolo disponível nesta instalação',
      request: { body: json(SsoConfigSchema, 'configuração') },
      responses: {
        200: json(ConfigOut, 'salvo'),
        400: json(ErrorSchema, 'campos faltando ou protocolo indisponível'),
        ...errors,
      },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const body = c.req.valid('json');
      const old = await loadConfig(repo, me.accountId);
      const data: SsoConfig = { ...body, clientSecret: body.clientSecret || old?.data.clientSecret };
      if (data.enabled) {
        if (!providers[data.protocol])
          return c.json(
            {
              error: `SSO ${data.protocol.toUpperCase()} ainda não está disponível nesta instalação: salve desligado.`,
            },
            400,
          );
        const missing =
          data.protocol === 'oidc'
            ? !data.issuer || !data.clientId || !data.clientSecret
            : !data.ssoUrl || !data.idpCert;
        if (missing) return c.json({ error: 'Preencha os dados do provedor antes de ligar.' }, 400);
      }
      await repo.saveEntity(me.accountId, { id: old?.id, kind: SSO_KIND, name: 'SSO', data, userId: me.id });
      const { [SECRET_MASK]: s, ...config } = data;
      return c.json({ config, hasClientSecret: !!s, available }, 200);
    },
  );

  // ---------- Fluxo no navegador (fora da especificação: são redirecionamentos) ----------
  const fail = (origin: string, msg: string) => `${origin}/#sso_error=${encodeURIComponent(msg)}`;

  app.get('/auth/sso/:accountId/start', async (c) => {
    const p = AccParam.safeParse(c.req.param());
    const origin = c.req.query('origin') ?? '';
    if (!p.success || !editorOrigins.includes(origin)) return c.json({ error: 'origem inválida' }, 400);
    const acc = p.data.accountId;
    const cfg = (await loadConfig(repo, acc))?.data;
    const provider = cfg?.enabled ? providers[cfg.protocol] : undefined;
    if (!cfg || !provider) return c.json({ error: 'SSO não configurado nesta conta' }, 404);
    const state = await sign(
      { acc, origin, typ: 'sso', exp: Math.floor(Date.now() / 1000) + STATE_TTL_S },
      secret,
      'HS256',
    );
    const callbackUrl = new URL(`/auth/sso/${encodeURIComponent(acc)}/callback`, c.req.url).href;
    return c.redirect(await provider.authorize(cfg, { callbackUrl, state }), 302);
  });

  /** OIDC volta por GET (query), SAML por POST (formulário). Sessão aberta sem TOTP: o IdP cuida da 2ª etapa. */
  const callback = async (c: Context<{ Variables: AuthVars }>) => {
    const acc = c.req.param('accountId') ?? '';
    const query = c.req.query();
    const form =
      c.req.method === 'POST'
        ? Object.fromEntries(
            Object.entries(await c.req.parseBody().catch(() => ({}))).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          )
        : {};
    const raw = query.state ?? form.RelayState ?? form.state ?? '';
    const st = (await verify(raw, secret, 'HS256').catch(() => null)) as {
      acc?: string;
      origin?: string;
      typ?: string;
    } | null;
    if (!st || st.typ !== 'sso' || st.acc !== acc || !st.origin || !editorOrigins.includes(st.origin))
      return c.json({ error: 'retorno de SSO inválido ou vencido' }, 400);
    const cfg = (await loadConfig(repo, acc))?.data;
    const provider = cfg?.enabled ? providers[cfg.protocol] : undefined;
    if (!cfg || !provider) return c.redirect(fail(st.origin, 'SSO desligado nesta conta.'), 302);
    const callbackUrl = new URL(`/auth/sso/${encodeURIComponent(acc)}/callback`, c.req.url).href;
    const who = await provider.verify(cfg, { callbackUrl, query, form }).catch(() => null);
    if (!who) return c.redirect(fail(st.origin, 'O provedor de identidade recusou o login.'), 302);
    const person = await repo.findUserByEmail(who.email);
    const user = person && (await repo.getUser(acc, person.id));
    if (!user) return c.redirect(fail(st.origin, 'Este e-mail não é membro da conta.'), 302);
    const token = await openSession(repo, secret, c, user);
    return c.redirect(`${st.origin}/#sso=${encodeURIComponent(token)}`, 302);
  };
  app.get('/auth/sso/:accountId/callback', callback);
  app.post('/auth/sso/:accountId/callback', callback);
}
