import type { AntiFlicker, Goal, Operation, PublishedConfig, Segmentation, Variation } from '@abtest/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
  createdAt: createdAt(),
});

const accountId = () =>
  text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' });

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    accountId: accountId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull().default('editor'),
    /** customJS só pode ser PUBLICADO por quem tem esta permissão (owner sempre pode). */
    canPublishJs: boolean('can_publish_js').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_account_idx').on(t.accountId)],
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
