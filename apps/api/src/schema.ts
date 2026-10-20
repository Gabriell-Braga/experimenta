import type { AntiFlicker, Goal, Operation, PublishedConfig, Segmentation, Variation } from '@abtest/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Multi-tenant: TODA tabela (exceto accounts) tem account_id, e toda consulta filtra por ele (ver repo.ts).

export const roleEnum = pgEnum('role', ['owner', 'editor', 'viewer']);
export const statusEnum = pgEnum('experiment_status', ['draft', 'running', 'paused', 'archived']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Fração de visitantes com captura de mapa de calor (null = padrão do servidor, HEATMAP_SAMPLE_RATE). */
  heatmapSampleRate: real('heatmap_sample_rate'),
  /** Publicação passa por aprovação de quem pode publicar JS (fase 16.4, D-072). */
  requireApproval: boolean('require_approval').notNull().default(false),
  /** Todo membro precisa do login em duas etapas (TOTP) para usar a conta (fase 16.5, D-073). */
  requireTotp: boolean('require_totp').notNull().default(false),
  createdAt: createdAt(),
});

const accountId = () =>
  text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' });

/** Pessoa (login). Papel e permissões ficam em `memberships`, uma linha por conta (fase 16.2). */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Conta padrão ao entrar (onde a pessoa foi criada); o acesso vem de `memberships`. */
    accountId: accountId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Login em duas etapas (TOTP) da pessoa; null = nunca configurou (fase 16.5, D-073). */
    mfa: jsonb('mfa').$type<Mfa>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_account_idx').on(t.accountId)],
);

/** Estado do TOTP da pessoa. O segredo nunca sai da API depois de confirmado. */
export interface Mfa {
  /** Segredo base32. Com `enabled` false, é o segredo em configuração (ainda não confirmado). */
  secret: string;
  enabled: boolean;
  /** SHA-256 dos códigos de recuperação ainda não usados. */
  recovery: string[];
  /** Último passo de 30 s aceito (o mesmo código não vale duas vezes). */
  lastStep: number;
  /** Erros seguidos; no 5º, bloqueia por 15 min (`lockedUntil`, ms). */
  failures: number;
  lockedUntil: number;
}

/**
 * Sessão de login (fase 16.5): o JWT carrega o id (`sid`) e o middleware confere a cada requisição, então
 * encerrar a sessão derruba o token na hora. A sessão é da pessoa (vale em todas as contas dela, como o login);
 * `account_id` = conta ativa mais recente (troca de conta atualiza), só para mostrar na lista.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('user_sessions_user_idx').on(t.userId)],
);

/** Pessoa ↔ conta, com o papel nessa conta. Uma pessoa pode estar em várias contas. */
export const memberships = pgTable(
  'memberships',
  {
    accountId: accountId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('editor'),
    /** customJS só pode ser PUBLICADO por quem tem esta permissão (owner sempre pode). */
    canPublishJs: boolean('can_publish_js').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    name: text('name').notNull(),
    siteUrl: text('site_url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('projects_account_idx').on(t.accountId)],
);

export const experiments = pgTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    status: statusEnum('status').notNull().default('draft'),
    traffic: real('traffic').notNull().default(100),
    segmentation: jsonb('segmentation').$type<Segmentation>().notNull(),
    antiFlicker: jsonb('anti_flicker').$type<AntiFlicker>().notNull(),
    /** Página aberta no editor para este experimento. */
    editorUrl: text('editor_url').notNull(),
    /** Tipo de campanha, MVT, alocação, audiências (EXPERIMENT_OPTION_KEYS). */
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('experiments_account_key_uq').on(t.accountId, t.key),
    index('experiments_project_idx').on(t.projectId),
  ],
);

export const variations = pgTable(
  'variations',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Posição na lista (0 = controle). */
    position: integer('position').notNull(),
    weight: integer('weight').notNull(),
    operations: jsonb('operations').$type<Operation[]>().notNull(),
    customCss: text('custom_css').notNull().default(''),
    customJs: text('custom_js').notNull().default(''),
    redirect: jsonb('redirect').$type<Variation['redirect']>(),
    /** Variáveis (server-side) e combinação (MVT) — VARIATION_EXTRA_KEYS. */
    extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('variations_exp_key_uq').on(t.experimentId, t.key),
    index('variations_account_idx').on(t.accountId),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    position: integer('position').notNull(),
    /** Goal completo (tipo + seletor/url/evento), validado pelo schema zod. */
    definition: jsonb('definition').$type<Goal>().notNull(),
  },
  (t) => [index('goals_experiment_idx').on(t.experimentId), index('goals_account_idx').on(t.accountId)],
);

/** Cada salvamento gera uma versão (snapshot completo) — histórico e restauração (tarefa 6.4). */
export const experimentVersions = pgTable(
  'experiment_versions',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('versions_exp_version_uq').on(t.experimentId, t.version),
    index('versions_account_idx').on(t.accountId),
  ],
);

/** Configurações publicadas na CDN (só leitura depois de criadas). */
export const publications = pgTable(
  'publications',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    version: integer('version').notNull(),
    config: jsonb('config').$type<PublishedConfig>().notNull(),
    publishedBy: text('published_by'),
    publishedAt: createdAt(),
  },
  (t) => [uniqueIndex('publications_account_version_uq').on(t.accountId, t.version)],
);

/**
 * Eventos recebidos do snippet (POST /collect). Fonte para o painel de saúde dos seletores (6.1);
 * a análise estatística fica com o módulo de analytics.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    type: text('type').notNull(),
    experimentId: text('experiment_id'),
    variationId: text('variation_id'),
    /** Visitante e sessão (colunas para consultas de jornada, funis, perfis e gravações). */
    visitorId: text('visitor_id'),
    sessionId: text('session_id'),
    payload: jsonb('payload').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    index('events_account_type_idx').on(t.accountId, t.type, t.experimentId),
    index('events_account_ts_idx').on(t.accountId, t.ts),
    index('events_session_idx').on(t.accountId, t.sessionId),
    index('events_visitor_idx').on(t.accountId, t.visitorId),
  ],
);

/** Gravação de sessão (tarefa 10.3): metadados por sessão; os eventos rrweb ficam em `recording_chunks`. */
export const recordings = pgTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    sessionId: text('session_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    /** URLs visitadas na ordem (eventos Meta do rrweb). */
    pages: jsonb('pages').$type<string[]>().notNull(),
    device: text('device').notNull(),
    vw: integer('vw').notNull(),
    vh: integer('vh').notNull(),
    events: integer('events').notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('recordings_session_uq').on(t.accountId, t.sessionId),
    index('recordings_started_idx').on(t.accountId, t.startedAt),
  ],
);

export const recordingChunks = pgTable(
  'recording_chunks',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    sessionId: text('session_id').notNull(),
    firstTs: timestamp('first_ts', { withTimezone: true }).notNull(),
    data: jsonb('data').$type<unknown[]>().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [index('recording_chunks_session_idx').on(t.accountId, t.sessionId, t.firstTs)],
);

/**
 * Entidades de configuração dos módulos (funis, audiências, campanhas, pesquisas, flags, webhooks…), validadas
 * pelos schemas zod de `@abtest/shared/entities` conforme o `kind`. Uma tabela genérica em vez de uma por módulo:
 * todas são documentos pequenos lidos por conta + tipo (ver D-049).
 */
export const entities = pgTable(
  'entities',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    data: jsonb('data').notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('entities_account_kind_idx').on(t.accountId, t.kind)],
);

/**
 * Histórico de atividades (auditoria, fase 16.3): quem fez o quê e quando. Nome da pessoa e do alvo ficam
 * copiados na linha, para o histórico continuar legível depois que a pessoa sai da conta ou o alvo é excluído.
 */
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    userId: text('user_id'),
    userName: text('user_name').notNull(),
    /** create, update, delete, start, pause, publish… (ver audit.ts). */
    action: text('action').notNull(),
    /** experiment, project, publish, member, invite, apikey, settings ou o tipo da entidade. */
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    targetName: text('target_name').notNull(),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    index('activities_account_ts_idx').on(t.accountId, t.createdAt),
    index('activities_target_idx').on(t.accountId, t.targetId),
  ],
);

/**
 * Comentários em experimentos, campanhas e ideias (fase 16.6, D-074). Autor, nome do alvo e menções
 * (`[{ id, name }]`, só membros da conta) ficam copiados na linha, como no histórico de atividades.
 */
export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    /** experiment, popup, survey ou idea. */
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetName: text('target_name').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    body: text('body').notNull(),
    mentions: jsonb('mentions').$type<{ id: string; name: string }[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('comments_target_idx').on(t.accountId, t.targetId, t.createdAt)],
);

/**
 * Fila de reenvio dos webhooks (fase 19.4, D-092). Só entra aqui a entrega que falhou na primeira tentativa:
 * `pending` (aguardando `next_at`), `delivered` (deu certo num reenvio) ou `failed` (desistiu ou 4xx).
 * `body` é o JSON exato da primeira tentativa: mesma assinatura e mesmo `X-Abt-Delivery` (= id) em todas.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    webhookId: text('webhook_id').notNull(),
    type: text('type').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull(),
    nextAt: timestamp('next_at', { withTimezone: true }),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_hook_idx').on(t.accountId, t.webhookId, t.createdAt),
    index('webhook_deliveries_due_idx').on(t.status, t.nextAt),
  ],
);
