import type Anthropic from '@anthropic-ai/sdk';
import type { CompatAi } from './ai';
import { HTTPException } from 'hono/http-exception';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import {
  ExperimentSchema,
  NameSchema,
  targetUrlError,
  TrackingEventSchema,
  type Experiment,
  type TrackingEvent,
} from '@abtest/shared';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { auditLog } from './audit';
import { CSRF_HEADER, forbid, hasRole, requireAuth, setSessionCookie, type AuthVars } from './auth';
import { loginGuard } from './login-guard';
import { serveCdn, type CdnStore } from './cdn';
import { rebuildReco, serveReco } from './reco';
import { findConflicts } from './conflicts';
import { newId } from './crypto';
import { errors, ErrorSchema, json, security } from './http';
import { behavior } from './analytics/behavior';
import { normalizePage, NotFoundError, type Repo, type User } from './repo';
import { CDP_PATHS, cdpRoutes } from './routes/cdp';
import { DATA_PATHS, dataRoutes } from './routes/data';
import { background, INTEGRATION_PATHS, integrationRoutes } from './routes/integrations';
import { CRM_PATHS, crmRoutes, type CrmBase } from './crm';
import { EXPORT_PATHS, exportRoutes, type ExportBase } from './exports';
import { PREDICTIVE_PATHS, predictiveRoutes } from './routes/predictive';
import { ACTIVITY_PATHS, activityRoutes } from './routes/activities';
import { COMMENT_PATHS, commentRoutes } from './routes/comments';
import { previewRoutes } from './routes/previews';
import { SCHEDULE_PATHS, scheduleRoutes } from './routes/schedules';
import { AI_PATHS, aiRoutes } from './routes/ai';
import { aiSummaryRoutes } from './routes/ai-summary';
import { dispatchEvents, dispatchNotice, dispatchPublish } from './webhooks';
import { ENTITY_PATHS, entityRoutes } from './routes/entities';
import { RECORDING_PATHS, recordingRoutes } from './routes/recordings';
import { reportRoutes } from './routes/report';
import { TEAM_PATHS, teamRoutes } from './routes/team';
import { SECURITY_PATHS, securityRoutes } from './routes/security';
import { PRIVACY_PATHS, privacyRoutes } from './routes/privacy';
import { signupRoutes, type SendMail } from './routes/signup';
import { ssoRoutes, type SsoProviders } from './sso';
import { createSessionStore, type SessionStore } from './sessions';
import type { PublishResult } from './publish';
import {
  APPROVAL_PATHS,
  approvalRoutes,
  canApprove,
  requestPublish,
  settleRequests,
} from './routes/approvals';

export interface AppDeps {
  repo: Repo;
  cdn: CdnStore;
  /** Origins exatos do app do editor autorizados (CORS da API privada e sessões de edição). */
  editorOrigins: string[];
  jwtSecret: string;
  sessions?: SessionStore;
  /** Publicação (tarefa 4.3); injetada para não acoplar a API ao disco nos testes. */
  publish?: (accountId: string, user: User) => Promise<PublishResult>;
  /** Cliente da API do Claude (só com ANTHROPIC_API_KEY); sem ele as ideias vêm das regras. */
  ai?: Anthropic;
  /** Modelo grátis compatível com OpenAI (AI_BASE_URL/AI_MODEL), usado quando não há chave do Claude. */
  aiCompat?: CompatAi;
  /** Protocolos de SSO disponíveis (ponto de extensão, D-073); nenhum vem implementado. */
  sso?: SsoProviders;
  /** Endereços das APIs dos CRMs (só nos testes, servidor falso). */
  crmBase?: CrmBase;
  /** Endereços de S3/BigQuery/token do Google (só nos testes, servidores falsos). */
  exportBase?: ExportBase;
  /** Envio de e-mail (recuperação de senha); sem provedor só registra no log. */
  sendMail?: SendMail;
}

const ProjectOut = z.object({ id: z.string(), name: z.string(), siteUrl: z.string() }).openapi('Project');
const ExperimentRecordOut = z
  .object({
    experiment: ExperimentSchema,
    projectId: z.string(),
    editorUrl: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ExperimentRecord');
const ExperimentInput = z
  .object({ projectId: z.string(), editorUrl: z.string().url(), experiment: ExperimentSchema })
  .openapi('ExperimentInput');
const IdParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

// Mensagens de cota do D1/KV quando o plano grátis estoura (ex.: "Exceeded maximum daily rows written", "KV put() limit exceeded for the day").
const PLAN_LIMIT = /exceeded|limit .*for the day|daily limit|quota/i;

export function createApp(deps: AppDeps) {
  const repo = deps.repo;
  const sessions = deps.sessions ?? createSessionStore();
  const app = new OpenAPIHono<{ Variables: AuthVars }>({
    // Erros de validação do zod viram 400 com mensagem legível.
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          { error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
          400,
        );
    },
  });
  // Cota diária do plano grátis (D1 linhas escritas/lidas, KV escritas): 503 com código próprio para o editor dizer
  // que é limite da versão de testes, não erro. (Estouro de CPU não chega aqui: a Cloudflare encerra o Worker.)
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (PLAN_LIMIT.test(String(err?.message)))
      return c.json({ error: 'limite diário do plano gratuito atingido', code: 'plan_limit' }, 503);
    console.error(err);
    return c.json({ error: 'erro interno' }, 500);
  });
  // Cabeçalhos de segurança (20.6) em toda resposta. CORP fica desligado: /cdn/*.js é carregado por <script> no site
  // do cliente (outra origem) e o CORP same-origin do padrão bloquearia. XFO/frame-ancestors não afetam isso (só
  // valem para documento emoldurado; a API não é emoldurada em nenhum fluxo, nem no modo edição).
  app.use(
    secureHeaders({
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      xFrameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: { frameAncestors: ["'none'"] },
    }),
  );
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  // Byte NUL não é texto válido no Postgres (a consulta estoura 500); recusa logo na entrada, em URL ou corpo
  // (cru ou escapado em JSON).
  const hasNul = (s: string) => s.includes('\u0000') || /\\u0000/i.test(s);
  app.use(async (c, next) => {
    let url = c.req.url;
    try {
      url = decodeURIComponent(url);
    } catch {
      return c.json({ error: 'URL inválida' }, 400);
    }
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) ? '' : await c.req.text();
    if (hasNul(url) || hasNul(body)) return c.json({ error: 'caractere nulo não é permitido' }, 400);
    await next();
  });

  // ---------- Públicas (site do cliente) ----------
  app.get('/health', async (c) => c.json({ ok: await repo.ping() }));
  app.get('/cdn/:file', serveCdn(deps.cdn));
  app.use('/reco/*', cors({ origin: '*', allowMethods: ['GET'] }));
  app.get('/reco/:account/:strategy', serveReco(deps.cdn));
  app.use('/edit-sessions/:token', cors({ origin: '*', allowMethods: ['GET'] }));
  app.get('/edit-sessions/:token', async (c) => {
    const s = await sessions.get(c.req.param('token'));
    if (!s) return c.json({ error: 'sessão inválida ou expirada' }, 404);
    return c.json({ accountId: s.accountId, appOrigin: s.appOrigin, expiresAt: s.expiresAt });
  });

  // Coleta de eventos do snippet: sendBeacon com text/plain (sem preflight). Ver docs/EVENTOS.md.
  // ponytail: sem rate limit nem fila; colocar atrás de fila/limite quando houver tráfego real.
  app.use('/collect', cors({ origin: '*', allowMethods: ['POST'] }));
  app.post('/collect', async (c) => {
    const raw = await c.req.text();
    if (raw.length > 64 * 1024) return c.json({ error: 'lote grande demais' }, 413);
    let body: { events?: unknown[] } | null;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: 'JSON inválido' }, 400);
    }
    const valid = (Array.isArray(body?.events) ? body.events.slice(0, 200) : [])
      .map((e) => TrackingEventSchema.safeParse(e))
      .flatMap((r) => (r.success ? [r.data] : []));
    const byAccount = new Map<string, TrackingEvent[]>();
    for (const e of valid) byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);
    for (const [acc, list] of byAccount)
      if (await repo.accountExists(acc)) {
        await repo.insertEvents(acc, list);
        background(c, dispatchEvents(repo, acc, list));
      }
    return c.body(null, 204);
  });

  // ---------- Privadas (app do editor) ----------
  const privateCors = cors({
    origin: deps.editorOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['authorization', 'content-type', CSRF_HEADER],
    // Cookie httpOnly da sessão (D-099): só os origins do editor recebem resposta com credenciais.
    credentials: true,
  });
  const PRIVATE = [
    ...TEAM_PATHS,
    ...SECURITY_PATHS,
    ...PRIVACY_PATHS,
    '/account/sso',
    '/projects',
    '/projects/*',
    '/experiments',
    '/experiments/*',
    '/edit-sessions',
    '/publish',
    '/heatmap',
    '/account/settings',
    ...DATA_PATHS,
    ...RECORDING_PATHS,
    ...ENTITY_PATHS,
    ...CDP_PATHS,
    ...INTEGRATION_PATHS,
    ...CRM_PATHS,
    ...EXPORT_PATHS,
    ...PREDICTIVE_PATHS,
    ...AI_PATHS,
    ...ACTIVITY_PATHS,
    ...APPROVAL_PATHS,
    ...COMMENT_PATHS,
    ...SCHEDULE_PATHS,
    '/recommendations/*',
  ];
  for (const p of ['/auth/*', ...PRIVATE]) app.use(p, privateCors);
  // Força bruta: limite por IP e por e-mail (login-guard.ts).
  const guard = loginGuard(repo, deps.jwtSecret);
  app.use('/auth/login', guard);
  app.use('/auth/login/totp', guard);
  const auth = requireAuth(repo, deps.jwtSecret, deps.editorOrigins);
  for (const p of PRIVATE) app.use(p, auth);
  // Depois da autenticação: registra as escritas bem sucedidas no histórico de atividades (audit.ts).
  app.use('*', auditLog(repo));

  // Volta do SSO: o editor recebe o token no #hash e troca pelo cookie httpOnly (não guarda o token).
  app.post('/auth/cookie', auth, (c) => {
    const token = (c.req.header('authorization') ?? '').slice(7);
    if (!c.get('sid') || !c.req.header(CSRF_HEADER)) return forbid(c);
    setSessionCookie(c, token);
    return c.body(null, 204);
  });

  teamRoutes(app, repo, deps.jwtSecret);
  signupRoutes(app, repo, deps.jwtSecret, deps.editorOrigins, deps.sendMail);
  securityRoutes(app, repo, deps.jwtSecret);
  ssoRoutes(app, repo, deps.jwtSecret, deps.sso ?? {}, deps.editorOrigins);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/projects',
      tags: ['projects'],
      security,
      responses: { 200: json(z.array(ProjectOut), 'projetos da conta'), 401: errors[401] },
    }),
    async (c) => {
      const rows = await repo.listProjects(c.get('user').accountId);
      return c.json(
        rows.map(({ id, name, siteUrl }) => ({ id, name, siteUrl })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/projects',
      tags: ['projects'],
      security,
      request: {
        body: json(z.object({ name: NameSchema, siteUrl: z.string().url().max(2000) }), 'novo projeto'),
      },
      responses: { 201: json(ProjectOut, 'criado'), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const p = await repo.createProject(user.accountId, c.req.valid('json'));
      return c.json({ id: p.id, name: p.name, siteUrl: p.siteUrl }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments',
      tags: ['experiments'],
      security,
      responses: {
        200: json(
          z.array(
            z.object({
              id: z.string(),
              key: z.string(),
              name: z.string(),
              status: z.string(),
              projectId: z.string(),
              editorUrl: z.string(),
              updatedAt: z.string(),
              traffic: z.number(),
              variations: z.number(),
              type: z.string(),
            }),
          ),
          'experimentos da conta',
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const rows = await repo.listExperiments(c.get('user').accountId);
      return c.json(
        rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
        200,
      );
    },
  );

  const save = (user: User, body: z.infer<typeof ExperimentInput>) =>
    repo.saveExperiment(user.accountId, { ...body, userId: user.id });
  /** URLs do teste (página do editor, páginas do funil, redirecionamentos) só nos sites do workspace e sem dado pessoal. */
  const urlError = async (accountId: string, editorUrl: string, e: Experiment, projectId?: string) => {
    const projects = await repo.listProjects(accountId);
    // Projeto de outra conta: segue para o 404 do repositório (não diz nada sobre a URL).
    if (projectId && !projects.some((p) => p.id === projectId)) return null;
    const sites = projects.map((p) => p.siteUrl);
    const urls = [
      editorUrl,
      ...(e.pages ?? []).map((p) => p.url),
      ...e.variations.flatMap((v) => (v.redirect ? [v.redirect.url] : [])),
    ];
    for (const u of urls) {
      const err = targetUrlError(u, sites);
      if (err) return err;
    }
    return null;
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments',
      tags: ['experiments'],
      security,
      request: { body: json(ExperimentInput, 'experimento completo') },
      responses: {
        201: json(z.object({ version: z.number() }), 'criado'),
        ...errors,
        400: json(ErrorSchema, 'URL fora dos sites do workspace ou com dado pessoal'),
        409: json(ErrorSchema, 'chave já usada'),
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const body = c.req.valid('json');
      const bad = await urlError(user.accountId, body.editorUrl, body.experiment, body.projectId);
      if (bad) return c.json({ error: bad }, 400);
      try {
        return c.json({ version: await save(user, body) }, 201);
      } catch (e) {
        if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
        return c.json({ error: 'chave de experimento já usada nesta conta' }, 409);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}',
      tags: ['experiments'],
      security,
      request: { params: IdParam },
      responses: { 200: json(ExperimentRecordOut, 'experimento'), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const r = await repo.getExperiment(c.get('user').accountId, c.req.valid('param').id);
      if (!r) return c.json({ error: 'experimento não encontrado' }, 404);
      return c.json({ ...r, updatedAt: r.updatedAt.toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/experiments/{id}',
      tags: ['experiments'],
      security,
      request: { params: IdParam, body: json(ExperimentInput, 'experimento completo') },
      responses: {
        200: json(z.object({ version: z.number() }), 'salvo (nova versão)'),
        ...errors,
        400: json(ErrorSchema, 'inválido'),
        409: json(ErrorSchema, 'chave já usada'),
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const body = c.req.valid('json');
      if (body.experiment.id !== c.req.valid('param').id)
        return c.json({ error: 'id do corpo difere da URL' }, 400);
      const bad = await urlError(user.accountId, body.editorUrl, body.experiment, body.projectId);
      if (bad) return c.json({ error: bad }, 400);
      try {
        return c.json({ version: await save(user, body) }, 200);
      } catch (e) {
        if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
        return c.json({ error: 'chave de experimento já usada nesta conta' }, 409);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/experiments/{id}',
      tags: ['experiments'],
      security,
      request: { params: IdParam },
      responses: { 204: { description: 'removido' }, ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      if (!(await repo.deleteExperiment(user.accountId, c.req.valid('param').id)))
        return c.json({ error: 'experimento não encontrado' }, 404);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/versions',
      tags: ['experiments'],
      security,
      request: { params: IdParam },
      responses: {
        200: json(
          z.array(z.object({ version: z.number(), createdBy: z.string().nullable(), createdAt: z.string() })),
          'versões',
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const rows = await repo.listVersions(c.get('user').accountId, c.req.valid('param').id);
      return c.json(
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        200,
      );
    },
  );

  const VersionParams = IdParam.extend({
    v: z.coerce
      .number()
      .int()
      .positive()
      .openapi({ param: { name: 'v', in: 'path' } }),
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/versions/{v}',
      tags: ['experiments'],
      security,
      request: { params: VersionParams },
      responses: {
        200: json(z.object({ experiment: ExperimentSchema, editorUrl: z.string() }), 'snapshot da versão'),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      const { id, v } = c.req.valid('param');
      const snap = await repo.getVersion(c.get('user').accountId, id, v);
      if (!snap) return c.json({ error: 'versão não encontrada' }, 404);
      return c.json(snap, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments/{id}/versions/{v}/restore',
      tags: ['experiments'],
      security,
      summary: 'Restaura uma versão gravando-a como NOVA versão (o histórico não é apagado)',
      request: { params: VersionParams },
      responses: {
        200: json(z.object({ version: z.number() }), 'restaurada como nova versão'),
        ...errors,
        400: json(ErrorSchema, 'URL inválida'),
        409: json(ErrorSchema, 'chave já usada'),
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, v } = c.req.valid('param');
      const snap = await repo.getVersion(user.accountId, id, v);
      const current = await repo.getExperiment(user.accountId, id);
      if (!snap || !current) return c.json({ error: 'versão não encontrada' }, 404);
      const bad = await urlError(user.accountId, snap.editorUrl, snap.experiment);
      if (bad) return c.json({ error: bad }, 400);
      try {
        const version = await repo.saveExperiment(user.accountId, {
          projectId: current.projectId,
          editorUrl: snap.editorUrl,
          experiment: snap.experiment,
          userId: user.id,
        });
        return c.json({ version }, 200);
      } catch {
        return c.json({ error: 'a chave desta versão já é usada por outro experimento' }, 409);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/health',
      tags: ['experiments'],
      security,
      summary: 'Saúde dos seletores: falhas e curas por operação (eventos do snippet)',
      request: { params: IdParam },
      responses: {
        200: json(
          z
            .object({
              exposures: z.record(z.number()),
              operations: z.array(
                z.object({
                  operationId: z.string(),
                  variationId: z.string().nullable(),
                  failed: z.number(),
                  healed: z.number(),
                  lastSeen: z.string(),
                  lastHealed: z.object({ healedSelector: z.string(), via: z.string() }).nullable(),
                }),
              ),
            })
            .openapi('ExperimentHealth'),
          'saúde',
        ),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      const id = c.req.valid('param').id;
      if (!(await repo.getExperiment(accountId, id)))
        return c.json({ error: 'experimento não encontrado' }, 404);
      return c.json(await repo.experimentHealth(accountId, id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/experiments/{id}/conflicts',
      tags: ['experiments'],
      security,
      summary: 'Outros experimentos que alteram os mesmos elementos em páginas que podem coincidir',
      request: { params: IdParam },
      responses: {
        200: json(
          z.array(
            z
              .object({
                experimentId: z.string(),
                name: z.string(),
                status: z.string(),
                selectors: z.array(z.string()),
              })
              .openapi('Conflict'),
          ),
          'conflitos',
        ),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      const all = await repo.loadAllRecords(c.get('user').accountId);
      const self = all.find((r) => r.experiment.id === c.req.valid('param').id);
      if (!self) return c.json({ error: 'experimento não encontrado' }, 404);
      return c.json(findConflicts(self, all), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/heatmap',
      tags: ['heatmap'],
      security,
      summary: 'Mapa de calor/cliques e scroll de uma página (filtros: variação, dispositivo e período)',
      request: {
        query: z.object({
          url: z.string().url(),
          experimentId: z.string().optional(),
          variationId: z.string().optional(),
          device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
          /** Últimos N dias; ausente = todo o histórico guardado. */
          days: z.coerce.number().int().min(1).max(365).optional(),
        }),
      },
      responses: {
        200: json(
          z
            .object({
              page: z.string(),
              clicks: z.object({
                total: z.number(),
                elements: z.array(
                  z.object({
                    selector: z.string(),
                    count: z.number(),
                    points: z.array(z.tuple([z.number(), z.number()])),
                  }),
                ),
              }),
              scroll: z.object({
                pageviews: z.number(),
                reached: z.array(z.object({ depth: z.number(), pct: z.number() })),
              }),
              moves: z.array(z.tuple([z.number(), z.number()])),
              frustration: z.array(
                z.object({
                  selector: z.string(),
                  rage: z.number(),
                  dead: z.number(),
                  points: z.array(z.tuple([z.number(), z.number()])),
                }),
              ),
            })
            .openapi('Heatmap'),
          'agregado',
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const accountId = c.get('user').accountId;
      const { days, ...q } = c.req.valid('query');
      const from = days ? new Date(Date.now() - days * 86_400_000) : undefined;
      const [base, extra] = await Promise.all([
        repo.heatmap(accountId, { ...q, from }),
        repo.listEvents(accountId, { page: normalizePage(q.url), types: ['move', 'frustration'], from }),
      ]);
      return c.json({ ...base, ...behavior(extra, q) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/experiments/{id}/status',
      tags: ['experiments'],
      security,
      summary: 'Muda só o status (ação rápida da lista); gera nova versão',
      request: {
        params: IdParam,
        body: json(z.object({ status: ExperimentSchema.innerType().shape.status }), 'novo status'),
      },
      responses: { 200: json(z.object({ version: z.number() }), 'salvo'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const r = await repo.getExperiment(user.accountId, c.req.valid('param').id);
      if (!r) return c.json({ error: 'experimento não encontrado' }, 404);
      const experiment = { ...r.experiment, status: c.req.valid('json').status };
      return c.json(
        { version: await save(user, { projectId: r.projectId, editorUrl: r.editorUrl, experiment }) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments/{id}/duplicate',
      tags: ['experiments'],
      security,
      summary: 'Cria uma cópia em rascunho (ids novos, inclusive das operações)',
      request: { params: IdParam },
      responses: {
        201: json(z.object({ id: z.string() }), 'cópia criada'),
        ...errors,
        400: json(ErrorSchema, 'URL inválida'),
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const r = await repo.getExperiment(user.accountId, c.req.valid('param').id);
      if (!r) return c.json({ error: 'experimento não encontrado' }, 404);
      const e = r.experiment;
      const bad = await urlError(user.accountId, r.editorUrl, e);
      if (bad) return c.json({ error: bad }, 400);
      // Ids de operação também mudam: o snippet usa o id da operação para idempotência.
      const experiment = {
        ...e,
        id: newId('exp'),
        key: `${e.key}-copia-${Math.random().toString(36).slice(2, 6)}`.slice(0, 60),
        name: `${e.name} (cópia)`,
        status: 'draft' as const,
        variations: e.variations.map((v) => ({
          ...v,
          id: newId('var'),
          operations: v.operations.map((o) => ({ ...o, id: newId('op') })),
        })),
        goals: e.goals.map((g) => ({ ...g, id: newId('goal') })),
      };
      await save(user, { projectId: r.projectId, editorUrl: r.editorUrl, experiment });
      return c.json({ id: experiment.id }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/edit-sessions',
      tags: ['editor'],
      security,
      summary: 'Abre sessão de edição (token curto validado pelo snippet)',
      responses: {
        201: json(
          z.object({
            token: z.string(),
            accountId: z.string(),
            appOrigin: z.string(),
            expiresAt: z.number(),
          }),
          'sessão',
        ),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      const origin = c.req.header('origin') ?? '';
      if (!deps.editorOrigins.includes(origin)) return forbid(c, 'origin não autorizado');
      // Qualquer papel: o viewer usa a sessão só para ver mapas de calor sobre o site (salvar continua exigindo editor).

      return c.json(await sessions.create(user.accountId, origin), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/publish',
      tags: ['publish'],
      security,
      summary:
        'Compila os experimentos em execução e grava a configuração na CDN. Conta com aprovação: quem não pode aprovar recebe 202 e vira um pedido',
      responses: {
        200: json(z.object({ version: z.number() }), 'publicado'),
        202: json(z.object({ pending: z.literal(true), requestId: z.string() }), 'pedido de aprovação'),
        ...errors,
        400: json(ErrorSchema, 'inválido'),
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      if (!deps.publish) return c.json({ error: 'publicação indisponível' }, 400);
      const r = await deps.publish(user.accountId, user);
      if ('error' in r) {
        if (!r.needsApproval) return c.json({ error: r.error }, r.status);
        const { request, created } = await requestPublish(repo, user);
        if (created)
          background(c, dispatchNotice(repo, user.accountId, 'approval', { status: 'pending', request }));
        return c.json({ pending: true as const, requestId: request.id }, 202);
      }
      // Quem pode aprovar publicou: os pedidos pendentes foram ao ar junto.
      const settled = canApprove(user) ? await settleRequests(repo, user, r.version) : [];
      background(
        c,
        Promise.all([
          dispatchPublish(repo, user.accountId, r.version),
          ...settled.map((q) =>
            dispatchNotice(repo, user.accountId, 'approval', { status: q.status, request: q }),
          ),
        ]),
      );
      return c.json({ version: r.version }, 200);
    },
  );

  const AccountSettingsSchema = z
    .object({
      /** null = padrão do servidor (HEATMAP_SAMPLE_RATE). */
      heatmapSampleRate: z.number().min(0).max(1).nullable(),
      /** Publicação passa por aprovação (owner ou "publica JS"); ausente = mantém. */
      requireApproval: z.boolean().optional(),
    })
    .openapi('AccountSettings');

  app.openapi(
    createRoute({
      method: 'get',
      path: '/account/settings',
      tags: ['conta'],
      security,
      summary: 'Configurações da conta (amostragem do mapa de calor)',
      responses: { 200: json(AccountSettingsSchema, 'configurações'), ...errors },
    }),
    async (c) => c.json(await repo.getAccountSettings(c.get('user').accountId), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/account/settings',
      tags: ['conta'],
      security,
      summary: 'Altera as configurações da conta (só owner; vale a partir da próxima publicação)',
      request: { body: { content: { 'application/json': { schema: AccountSettingsSchema } } } },
      responses: { 200: json(AccountSettingsSchema, 'salvo'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'owner')) return forbid(c);
      const body = c.req.valid('json');
      const s = {
        heatmapSampleRate: body.heatmapSampleRate,
        requireApproval:
          body.requireApproval ?? (await repo.getAccountSettings(user.accountId)).requireApproval,
      };
      await repo.updateAccountSettings(user.accountId, s);
      return c.json(s, 200);
    },
  );

  dataRoutes(app, repo);
  reportRoutes(app, repo, deps.publish);
  recordingRoutes(app, repo);
  entityRoutes(app, repo);
  cdpRoutes(app, repo, deps.cdn);
  integrationRoutes(app, repo);
  crmRoutes(app, repo, deps.crmBase);
  exportRoutes(app, repo, deps.exportBase);
  predictiveRoutes(app, repo, deps.publish);
  aiRoutes(app, repo, deps.ai, deps.aiCompat);
  aiSummaryRoutes(app, repo, deps.ai, deps.aiCompat);
  activityRoutes(app, repo);
  approvalRoutes(app, repo, deps.publish);
  commentRoutes(app, repo);
  previewRoutes(app, repo);
  scheduleRoutes(app, repo);
  privacyRoutes(app, repo);

  app.openapi(
    createRoute({
      method: 'post',
      path: '/recommendations/rebuild',
      tags: ['engajamento'],
      security,
      summary:
        'Recalcula agora o modelo de recomendações da conta (também roda de hora em hora e ao publicar)',
      responses: { 200: json(z.object({ products: z.number(), builtAt: z.string() }), 'modelo'), ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const m = await rebuildReco(repo, deps.cdn, user.accountId);
      return c.json({ products: Object.keys(m.catalog).length, builtAt: m.builtAt }, 200);
    },
  );

  app.doc31('/openapi.json', { openapi: '3.1.0', info: { title: 'A/B Editor API', version: '0.1.0' } });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));
  return app;
}
