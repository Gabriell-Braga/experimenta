import {
  EXPERIMENT_OPTION_KEYS,
  ExperimentSchema,
  pickKeys,
  VARIATION_EXTRA_KEYS,
  type Experiment,
  type PublishedConfig,
  type TrackingEvent,
} from '@abtest/shared';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  lt,
  lte,
  max,
  ne,
  notInArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { Db } from './db';
import {
  accounts,
  activities,
  comments,
  events,
  experiments,
  experimentVersions,
  goals,
  memberships,
  projects,
  entities,
  publications,
  recordingChunks,
  recordings,
  users,
  userSessions,
  variations,
  webhookDeliveries,
  type Mfa,
} from './schema';

import { hashPassword, newId } from './crypto';

export { hashPassword, newId, verifyPassword } from './crypto';

export type Role = 'owner' | 'editor' | 'viewer';
/** Pessoa (login). `accountId` = conta padrão ao entrar. */
export type Person = typeof users.$inferSelect;
/** Pessoa dentro de uma conta: `accountId` = conta ativa; papel e permissão vêm da membership dessa conta. */
export type User = Person & {
  role: Role;
  canPublishJs: boolean;
  /** A conta ativa exige duas etapas (só `getUser` preenche: é o que o middleware de autenticação usa). */
  requireTotp?: boolean;
};
export type { Mfa };

/** Sessão de login (fase 16.5). */
export interface LoginSession {
  id: string;
  accountId: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
export interface NewLoginSession {
  userAgent: string;
  ip: string;
  expiresAt: Date;
}
/** `last_seen_at` só é regravado se estiver mais velho que isto (uma escrita a cada 5 min por sessão). */
export const SESSION_TOUCH_MS = 5 * 60_000;
/** Conta de que a pessoa é membro (troca de conta no menu do usuário). */
export interface AccountRef {
  id: string;
  name: string;
  role: Role;
}
export interface MemberAccess {
  role: Role;
  canPublishJs: boolean;
}

export interface ExperimentRecord {
  experiment: Experiment;
  projectId: string;
  editorUrl: string;
  updatedAt: Date;
}

export class NotFoundError extends Error {}

/** Data de corte da retenção de eventos crus (`days` <= 0 desliga: devolve null). */
export const retentionCutoff = (days: number, now = Date.now()) =>
  days > 0 ? new Date(now - days * 86_400_000) : null;

export interface AccountSettings {
  /** null = padrão do servidor. */
  heatmapSampleRate: number | null;
  /** Quem não pode aprovar pede publicação em vez de publicar (D-072). */
  requireApproval: boolean;
}

/** Filtro genérico de eventos crus (analytics em memória, ver D-041). */
export interface EventFilter {
  types?: string[];
  from?: Date;
  to?: Date;
  experimentId?: string;
  sessionId?: string;
  visitorIds?: string[];
  /** Página normalizada (`normalizePage`). */
  page?: string;
  /** Padrão EVENT_LIMIT. */
  limit?: number;
  order?: 'asc' | 'desc';
}
// ponytail: teto de eventos por consulta de analytics; pré-agregar por dia quando o volume passar disso.
export const EVENT_LIMIT = 50_000;

/** Bloco de gravação recebido do snippet (POST /rec). Eventos no formato do rrweb. */
export interface RecordingChunkInput {
  sessionId: string;
  visitorId: string;
  device: string;
  vw: number;
  vh: number;
  events: { timestamp: number; type: number; data?: unknown }[];
}
export interface RecordingMeta {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  pages: string[];
  device: string;
  vw: number;
  vh: number;
  events: number;
}
export interface RecordingFilter {
  from?: Date;
  to?: Date;
  device?: string;
  visitorIds?: string[];
  limit?: number;
}

/** Entidade de configuração de um módulo (funil, audiência, campanha…). `data` validado pelo schema do tipo. */
export interface Entity<T = unknown> {
  id: string;
  kind: string;
  name: string;
  data: T;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Linha do histórico de atividades (auditoria, fase 16.3). */
export interface ActivityInput {
  userId: string | null;
  userName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  detail?: string | null;
}
export interface Activity extends ActivityInput {
  id: string;
  detail: string | null;
  createdAt: string;
}
export interface ActivityFilter {
  userId?: string;
  targetType?: string;
  targetId?: string;
  /** Paginação: só atividades anteriores a este instante. */
  before?: Date;
  limit?: number;
}
/**
 * Salvamentos seguidos do mesmo alvo pela mesma pessoa em até 10 min viram uma linha só (a hora é atualizada):
 * clicar "Salvar" várias vezes não enche o histórico nem o limite de escritas do D1.
 */
export const ACTIVITY_MERGE_MS = 10 * 60_000;
export const mergeableActivity = (last: Activity | undefined, a: ActivityInput, now: number) =>
  !!last &&
  a.action === 'update' &&
  last.action === 'update' &&
  last.userId === a.userId &&
  last.targetType === a.targetType &&
  last.targetId === a.targetId &&
  now - new Date(last.createdAt).getTime() < ACTIVITY_MERGE_MS;

/** Comentário em experimento, campanha ou ideia (fase 16.6). */
export interface CommentInput {
  targetType: string;
  targetId: string;
  targetName: string;
  userId: string;
  userName: string;
  body: string;
  /** Membros mencionados (validados na rota). */
  mentions: { id: string; name: string }[];
}
export interface Comment extends CommentInput {
  id: string;
  createdAt: string;
}
/** Máximo de comentários devolvidos por alvo (os mais antigos ficam de fora). */
export const COMMENTS_PER_TARGET = 500;

/** Entrega de webhook na fila de reenvio (fase 19.4, D-092). */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  type: string;
  /** JSON exato enviado (a assinatura é sobre ele). */
  body: string;
  status: DeliveryStatus;
  attempts: number;
  nextAt: string | null;
  /** Status HTTP da última tentativa (0 = sem resposta). */
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export type NewDelivery = Omit<WebhookDelivery, 'createdAt' | 'updatedAt'>;
export type DeliveryUpdate = Pick<
  WebhookDelivery,
  'status' | 'attempts' | 'nextAt' | 'lastStatus' | 'lastError'
>;

/** Posição na lista de eventos em ordem (ts, id): o último exportado (exportação incremental, 19.4). */
export type EventCursor = [number, string];
export interface EventPage {
  /** Depois deste evento (exclusivo); null = desde o começo. */
  after: EventCursor | null;
  /** Até este evento (inclusivo). */
  through?: EventCursor;
  /** Só eventos com ts anterior a este instante. */
  before?: Date;
  excludeTypes?: string[];
  limit: number;
}

/** Primeira/última marca de tempo e páginas (eventos Meta do rrweb, tipo 4) de um bloco. */
export function chunkSummary(list: RecordingChunkInput['events']) {
  let first = Infinity;
  let last = -Infinity;
  const pages: string[] = [];
  for (const e of list) {
    first = Math.min(first, e.timestamp);
    last = Math.max(last, e.timestamp);
    const href = e.type === 4 ? (e.data as { href?: unknown } | undefined)?.href : undefined;
    if (typeof href === 'string' && pages.at(-1) !== href) pages.push(href);
  }
  return { first, last, pages };
}

/** Junta páginas sem repetir a última (navegação em sequência). */
export const mergePages = (a: string[], b: string[]) => {
  const out = [...a];
  for (const p of b) if (out.at(-1) !== p) out.push(p);
  return out.slice(0, 200);
};

/** Final de caminho que não muda a página: `/index.html`, `.html` e barra final (`/loja/` = `/loja/index.html` = `/loja`). */
const PAGE_SUFFIX = /(\/index\.html?|\.html?)?\/?$/;

/**
 * Página (mapas de calor, funis, jornadas, formulários...): origin + caminho, sem query, hash, barra final,
 * `index.html` nem `.html`. Telas do app (`app://<appId>/<Tela>`, SDK React Native) não têm origin no padrão
 * de URL: viram `app://<appId>/<Tela>`. Única regra de página da API; `pageSql` é a mesma no Postgres e a
 * coluna `page` do D1 é gravada com esta função.
 */
export function normalizePage(url: string): string {
  let s: string;
  try {
    const u = new URL(url);
    s = (u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin) + u.pathname;
  } catch {
    s = url.split('#')[0]!.split('?')[0]!;
  }
  return s.replace(PAGE_SUFFIX, '');
}

/** Caminho da página normalizada (sem o domínio): agrupa a mesma rota servida em domínios diferentes. */
export const pagePath = (url: string) => normalizePage(url).replace(/^https?:\/\/[^/]+/, '') || '/';

/** `normalizePage` em SQL (Postgres) sobre a URL do payload do evento. */
const pageSql = (payload: AnyColumn) =>
  sql`regexp_replace(split_part(split_part(${payload}->>'url', '#', 1), '?', 1), ${PAGE_SUFFIX.source}, '')`;

/** % das páginas vistas que chegaram a 10, 20, … 100% de profundidade. */
export function scrollReached(depths: number[]) {
  const pageviews = depths.length;
  const reached = Array.from({ length: 10 }, (_, i) => {
    const depth = (i + 1) * 10;
    const n = depths.filter((d) => d >= depth).length;
    return { depth, pct: pageviews ? Math.round((n / pageviews) * 1000) / 10 : 0 };
  });
  return { pageviews, reached };
}

/**
 * Acesso a dados. Toda função de tenant recebe `accountId` e o usa em TODAS as cláusulas —
 * não existe consulta de experimento/variação/meta sem filtro de conta.
 */
const toEntity = <T>(r: typeof entities.$inferSelect): Entity<T> => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  data: r.data as T,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toComment = (r: typeof comments.$inferSelect): Comment => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  targetName: r.targetName,
  userId: r.userId,
  userName: r.userName,
  body: r.body,
  mentions: r.mentions,
  createdAt: r.createdAt.toISOString(),
});

const toDelivery = (r: typeof webhookDeliveries.$inferSelect): WebhookDelivery => ({
  id: r.id,
  webhookId: r.webhookId,
  type: r.type,
  body: r.body,
  status: r.status as DeliveryStatus,
  attempts: r.attempts,
  nextAt: r.nextAt?.toISOString() ?? null,
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export function createRepo(db: Db) {
  async function loadExperiment(accountId: string, id: string): Promise<ExperimentRecord | null> {
    const [row] = await db
      .select()
      .from(experiments)
      .where(and(eq(experiments.accountId, accountId), eq(experiments.id, id)));
    if (!row) return null;
    const vars = await db
      .select()
      .from(variations)
      .where(and(eq(variations.accountId, accountId), eq(variations.experimentId, id)))
      .orderBy(asc(variations.position));
    const gs = await db
      .select()
      .from(goals)
      .where(and(eq(goals.accountId, accountId), eq(goals.experimentId, id)))
      .orderBy(asc(goals.position));
    return {
      projectId: row.projectId,
      editorUrl: row.editorUrl,
      updatedAt: row.updatedAt,
      experiment: ExperimentSchema.parse({
        id: row.id,
        key: row.key,
        name: row.name,
        status: row.status,
        traffic: row.traffic,
        segmentation: row.segmentation,
        antiFlicker: row.antiFlicker,
        ...row.options,
        variations: vars.map((v) => ({
          ...v.extra,
          id: v.id,
          key: v.key,
          name: v.name,
          weight: v.weight,
          operations: v.operations,
          customCSS: v.customCss,
          customJS: v.customJs,
          ...(v.redirect ? { redirect: v.redirect } : {}),
        })),
        goals: gs.map((g) => g.definition),
      }),
    };
  }

  return {
    async ping(): Promise<boolean> {
      await db.execute(sql`select 1`);
      return true;
    },

    async createAccount(name: string, id = newId('acc')) {
      await db.insert(accounts).values({ id, name });
      return { id, name };
    },

    /** Cria a pessoa já como membro de `accountId` (conta padrão dela). E-mail é único no sistema. */
    async createUser(
      accountId: string,
      u: { email: string; name: string; password: string; role?: Role; canPublishJs?: boolean },
    ): Promise<User> {
      const access = { role: u.role ?? 'editor', canPublishJs: u.canPublishJs ?? false };
      const person = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            id: newId('usr'),
            accountId,
            email: u.email.toLowerCase(),
            name: u.name,
            passwordHash: await hashPassword(u.password),
          })
          .returning();
        await tx.insert(memberships).values({ accountId, userId: row!.id, ...access });
        return row!;
      });
      return { ...person, ...access };
    },

    /** Login é o único acesso sem conta conhecida: o e-mail é único no sistema. */
    async findUserByEmail(email: string): Promise<Person | undefined> {
      const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      return row;
    },

    /** A pessoa como membro da conta (undefined se não for membro). */
    async getUser(accountId: string, id: string): Promise<User | undefined> {
      const [row] = await db
        .select({
          ...getTableColumns(users),
          role: memberships.role,
          canPublishJs: memberships.canPublishJs,
          requireTotp: accounts.requireTotp,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(accounts, eq(accounts.id, memberships.accountId))
        .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, id)));
      return row && { ...row, accountId };
    },

    /** TOTP da pessoa (null apaga). Por pessoa, como o login: vale em todas as contas dela. */
    async setMfa(userId: string, mfa: Mfa | null): Promise<void> {
      await db.update(users).set({ mfa }).where(eq(users.id, userId));
    },

    async getRequireTotp(accountId: string): Promise<boolean> {
      const [row] = await db
        .select({ v: accounts.requireTotp })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      return !!row?.v;
    },

    async setRequireTotp(accountId: string, on: boolean): Promise<void> {
      await db.update(accounts).set({ requireTotp: on }).where(eq(accounts.id, accountId));
    },

    /** Abre uma sessão de login (e limpa as vencidas da pessoa). */
    async createSession(accountId: string, userId: string, s: NewLoginSession): Promise<string> {
      const id = newId('ses');
      await db
        .delete(userSessions)
        .where(and(eq(userSessions.userId, userId), lt(userSessions.expiresAt, new Date())));
      await db.insert(userSessions).values({ id, accountId, userId, ...s });
      return id;
    },

    /**
     * Sessão da pessoa ainda válida? Atualiza o "visto por último" no máximo a cada 5 min. Não confere a conta:
     * a sessão é da pessoa (tokens de outras contas da mesma sessão continuam valendo); a conta vem do token e
     * a membership é conferida em `getUser`.
     */
    async touchSession(userId: string, id: string): Promise<boolean> {
      const now = new Date();
      const where = and(eq(userSessions.id, id), eq(userSessions.userId, userId));
      const [row] = await db
        .select({ lastSeenAt: userSessions.lastSeenAt, expiresAt: userSessions.expiresAt })
        .from(userSessions)
        .where(where);
      if (!row || row.expiresAt <= now) return false;
      if (now.getTime() - row.lastSeenAt.getTime() > SESSION_TOUCH_MS)
        await db.update(userSessions).set({ lastSeenAt: now }).where(where);
      return true;
    },

    /** Troca de conta: a sessão passa a mostrar a conta nova como a ativa. */
    async moveSession(userId: string, id: string, accountId: string): Promise<boolean> {
      const rows = await db
        .update(userSessions)
        .set({ accountId })
        .where(and(eq(userSessions.id, id), eq(userSessions.userId, userId)))
        .returning({ id: userSessions.id });
      return rows.length > 0;
    },

    /** Sessões ativas da pessoa (em qualquer conta), mais recentes primeiro. */
    async listSessions(userId: string): Promise<LoginSession[]> {
      const rows = await db
        .select()
        .from(userSessions)
        .where(and(eq(userSessions.userId, userId), gte(userSessions.expiresAt, new Date())))
        .orderBy(desc(userSessions.lastSeenAt));
      return rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));
    },

    async deleteSession(userId: string, id: string): Promise<boolean> {
      const rows = await db
        .delete(userSessions)
        .where(and(eq(userSessions.id, id), eq(userSessions.userId, userId)))
        .returning({ id: userSessions.id });
      return rows.length > 0;
    },

    /** "Sair de todos": encerra todas as sessões da pessoa, menos `keep` (a atual). Devolve quantas. */
    async deleteOtherSessions(userId: string, keep: string): Promise<number> {
      const rows = await db
        .delete(userSessions)
        .where(and(eq(userSessions.userId, userId), ne(userSessions.id, keep)))
        .returning({ id: userSessions.id });
      return rows.length;
    },

    /** Contas da pessoa (por ordem de entrada). Filtra pela pessoa, não por conta: é a lista dela. */
    async listAccountsOf(userId: string): Promise<AccountRef[]> {
      return db
        .select({ id: accounts.id, name: accounts.name, role: memberships.role })
        .from(memberships)
        .innerJoin(accounts, eq(accounts.id, memberships.accountId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.createdAt), asc(accounts.name));
    },

    async listMembers(accountId: string): Promise<User[]> {
      const rows = await db
        .select({ ...getTableColumns(users), role: memberships.role, canPublishJs: memberships.canPublishJs })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.accountId, accountId))
        .orderBy(asc(memberships.createdAt));
      return rows.map((r) => ({ ...r, accountId }));
    },

    /** Põe a pessoa na conta com o papel dado (ou troca o papel, se já for membro). */
    async addMember(accountId: string, userId: string, access: MemberAccess): Promise<void> {
      await db
        .insert(memberships)
        .values({ accountId, userId, ...access })
        .onConflictDoUpdate({ target: [memberships.accountId, memberships.userId], set: access });
    },

    /** Muda o papel de quem já é membro. false = não é membro desta conta. */
    async updateMember(accountId: string, userId: string, access: MemberAccess): Promise<boolean> {
      const rows = await db
        .update(memberships)
        .set(access)
        .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)))
        .returning({ id: memberships.userId });
      return rows.length > 0;
    },

    /**
     * Tira a pessoa da conta. Sem nenhuma outra conta, a pessoa é apagada (não sobra login que não entra em nada);
     * se era a conta padrão dela, a padrão passa a ser outra conta de que é membro.
     */
    async removeMember(accountId: string, userId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const del = await tx
          .delete(memberships)
          .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)))
          .returning({ id: memberships.userId });
        if (!del.length) return false;
        const [rest] = await tx
          .select({ accountId: memberships.accountId })
          .from(memberships)
          .where(eq(memberships.userId, userId))
          .orderBy(asc(memberships.createdAt))
          .limit(1);
        if (!rest) await tx.delete(users).where(eq(users.id, userId));
        else
          await tx
            .update(users)
            .set({ accountId: rest.accountId })
            .where(and(eq(users.id, userId), eq(users.accountId, accountId)));
        return true;
      });
    },

    async createProject(accountId: string, p: { name: string; siteUrl: string }) {
      const [row] = await db
        .insert(projects)
        .values({ id: newId('prj'), accountId, ...p })
        .returning();
      return row!;
    },

    async listProjects(accountId: string) {
      return db
        .select()
        .from(projects)
        .where(eq(projects.accountId, accountId))
        .orderBy(asc(projects.createdAt));
    },

    async getProject(accountId: string, id: string) {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.accountId, accountId), eq(projects.id, id)));
      return row;
    },

    getExperiment: loadExperiment,

    async listExperiments(accountId: string) {
      const rows = await db
        .select({
          options: experiments.options,
          id: experiments.id,
          key: experiments.key,
          name: experiments.name,
          status: experiments.status,
          projectId: experiments.projectId,
          editorUrl: experiments.editorUrl,
          updatedAt: experiments.updatedAt,
          traffic: experiments.traffic,
          // Referências qualificadas à mão: dentro da subconsulta o Drizzle renderiza só "id" (ambíguo).
          variations: sql<number>`(select count(*)::int from variations v where v.experiment_id = "experiments"."id" and v.account_id = "experiments"."account_id")`,
        })
        .from(experiments)
        .where(eq(experiments.accountId, accountId))
        .orderBy(desc(experiments.updatedAt));
      return rows.map(({ options, ...r }) => ({ ...r, type: (options.type as string | undefined) ?? 'ab' }));
    },

    /**
     * Cria/atualiza o experimento inteiro (variações e metas substituídas) numa transação
     * e grava um snapshot como nova versão. Retorna o número da versão.
     */
    async saveExperiment(
      accountId: string,
      input: { projectId: string; editorUrl: string; experiment: Experiment; userId?: string },
    ): Promise<number> {
      const exp = ExperimentSchema.parse(input.experiment);
      return db.transaction(async (tx) => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.accountId, accountId), eq(projects.id, input.projectId)));
        if (!project) throw new NotFoundError('projeto não encontrado');

        const values = {
          projectId: input.projectId,
          key: exp.key,
          name: exp.name,
          status: exp.status,
          traffic: exp.traffic,
          segmentation: exp.segmentation,
          antiFlicker: exp.antiFlicker,
          options: pickKeys(exp, EXPERIMENT_OPTION_KEYS),
          editorUrl: input.editorUrl,
          updatedAt: new Date(),
        };
        const [existing] = await tx
          .select({ accountId: experiments.accountId })
          .from(experiments)
          .where(eq(experiments.id, exp.id));
        if (existing && existing.accountId !== accountId)
          throw new NotFoundError('experimento não encontrado');
        if (existing)
          await tx
            .update(experiments)
            .set(values)
            .where(and(eq(experiments.accountId, accountId), eq(experiments.id, exp.id)));
        else await tx.insert(experiments).values({ id: exp.id, accountId, ...values });

        await tx
          .delete(variations)
          .where(and(eq(variations.accountId, accountId), eq(variations.experimentId, exp.id)));
        await tx.insert(variations).values(
          exp.variations.map((v, position) => ({
            id: v.id,
            accountId,
            experimentId: exp.id,
            key: v.key,
            name: v.name,
            position,
            weight: v.weight,
            operations: v.operations,
            customCss: v.customCSS,
            customJs: v.customJS,
            redirect: v.redirect ?? null,
            extra: pickKeys(v, VARIATION_EXTRA_KEYS),
          })),
        );
        await tx.delete(goals).where(and(eq(goals.accountId, accountId), eq(goals.experimentId, exp.id)));
        if (exp.goals.length)
          await tx.insert(goals).values(
            exp.goals.map((g, position) => ({
              id: g.id,
              accountId,
              experimentId: exp.id,
              key: g.key,
              position,
              definition: g,
            })),
          );

        const [{ last } = { last: 0 }] = await tx
          .select({ last: max(experimentVersions.version) })
          .from(experimentVersions)
          .where(
            and(eq(experimentVersions.accountId, accountId), eq(experimentVersions.experimentId, exp.id)),
          );
        const version = (last ?? 0) + 1;
        await tx.insert(experimentVersions).values({
          id: newId('ver'),
          accountId,
          experimentId: exp.id,
          version,
          snapshot: { experiment: exp, editorUrl: input.editorUrl },
          createdBy: input.userId ?? null,
        });
        return version;
      });
    },

    async deleteExperiment(accountId: string, id: string): Promise<boolean> {
      const rows = await db
        .delete(experiments)
        .where(and(eq(experiments.accountId, accountId), eq(experiments.id, id)))
        .returning({ id: experiments.id });
      return rows.length > 0;
    },

    async listVersions(accountId: string, experimentId: string) {
      return db
        .select({
          version: experimentVersions.version,
          createdBy: experimentVersions.createdBy,
          createdAt: experimentVersions.createdAt,
        })
        .from(experimentVersions)
        .where(
          and(eq(experimentVersions.accountId, accountId), eq(experimentVersions.experimentId, experimentId)),
        )
        .orderBy(desc(experimentVersions.version));
    },

    async getVersion(accountId: string, experimentId: string, version: number) {
      const [row] = await db
        .select()
        .from(experimentVersions)
        .where(
          and(
            eq(experimentVersions.accountId, accountId),
            eq(experimentVersions.experimentId, experimentId),
            eq(experimentVersions.version, version),
          ),
        );
      return row ? (row.snapshot as { experiment: Experiment; editorUrl: string }) : undefined;
    },

    /** Todos os experimentos completos da conta, com a página de referência. */
    async loadAllRecords(accountId: string): Promise<ExperimentRecord[]> {
      const ids = await db
        .select({ id: experiments.id })
        .from(experiments)
        .where(eq(experiments.accountId, accountId))
        .orderBy(asc(experiments.createdAt));
      const out: ExperimentRecord[] = [];
      for (const { id } of ids) {
        const r = await loadExperiment(accountId, id);
        if (r) out.push(r);
      }
      return out;
    },

    /** Todos os experimentos completos da conta (para compilar a publicação). */
    async loadAllExperiments(accountId: string): Promise<Experiment[]> {
      return (await this.loadAllRecords(accountId)).map((r) => r.experiment);
    },

    async lastPublication(accountId: string) {
      const [row] = await db
        .select()
        .from(publications)
        .where(eq(publications.accountId, accountId))
        .orderBy(desc(publications.version))
        .limit(1);
      return row;
    },

    async accountExists(id: string): Promise<boolean> {
      const [row] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id));
      return !!row;
    },

    async getAccountName(id: string): Promise<string | undefined> {
      const [row] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, id));
      return row?.name;
    },

    async getAccountSettings(accountId: string): Promise<AccountSettings> {
      const [row] = await db
        .select({ heatmapSampleRate: accounts.heatmapSampleRate, requireApproval: accounts.requireApproval })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      return { heatmapSampleRate: row?.heatmapSampleRate ?? null, requireApproval: !!row?.requireApproval };
    },

    async updateAccountSettings(accountId: string, s: AccountSettings): Promise<void> {
      await db
        .update(accounts)
        .set({ heatmapSampleRate: s.heatmapSampleRate, requireApproval: s.requireApproval })
        .where(eq(accounts.id, accountId));
    },

    /**
     * Retenção: apaga eventos recebidos antes de `cutoff`. Manutenção do sistema (todas as contas) —
     * única consulta sem filtro de conta, de propósito; não é exposta em rota.
     */
    async purgeEventsBefore(cutoff: Date): Promise<void> {
      await db.delete(events).where(lt(events.receivedAt, cutoff));
      await db.delete(recordingChunks).where(lt(recordingChunks.receivedAt, cutoff));
      await db.delete(recordings).where(lt(recordings.endedAt, cutoff));
    },

    async insertEvents(accountId: string, list: TrackingEvent[]): Promise<void> {
      if (!list.length) return;
      await db
        .insert(events)
        .values(
          list.map((e) => ({
            id: e.eventId,
            accountId,
            type: e.type,
            // Eventos de mapa de calor não pertencem a um experimento só (ver payload.variations).
            experimentId: 'experimentId' in e ? e.experimentId : null,
            variationId: 'variationId' in e ? e.variationId : null,
            visitorId: e.visitorId,
            sessionId: e.sessionId ?? null,
            payload: e,
            ts: new Date(e.ts),
          })),
        )
        .onConflictDoNothing(); // eventId repetido (reenvio do beacon) é ignorado
    },

    /** Eventos crus (payload) da conta, por ordem de `ts`. */
    async listEvents(accountId: string, f: EventFilter = {}): Promise<TrackingEvent[]> {
      const conds: SQL[] = [eq(events.accountId, accountId)];
      if (f.types?.length) conds.push(inArray(events.type, f.types));
      if (f.from) conds.push(gte(events.ts, f.from));
      if (f.to) conds.push(lte(events.ts, f.to));
      if (f.experimentId) conds.push(eq(events.experimentId, f.experimentId));
      if (f.sessionId) conds.push(eq(events.sessionId, f.sessionId));
      if (f.visitorIds) conds.push(inArray(events.visitorId, f.visitorIds.length ? f.visitorIds : ['']));
      if (f.page) conds.push(sql`${pageSql(events.payload)} = ${f.page}`);
      const rows = await db
        .select({ payload: events.payload })
        .from(events)
        .where(and(...conds))
        .orderBy(f.order === 'desc' ? desc(events.ts) : asc(events.ts))
        .limit(f.limit ?? EVENT_LIMIT);
      return rows.map((r) => r.payload as TrackingEvent);
    },

    /**
     * Saúde dos seletores de um experimento a partir dos eventos coletados:
     * exposições por variação e, por operação, falhas e curas (último seletor curado e via).
     */
    async experimentHealth(accountId: string, experimentId: string) {
      const scope = and(eq(events.accountId, accountId), eq(events.experimentId, experimentId));
      const exposures = await db
        .select({ variationId: events.variationId, n: sql<number>`count(*)::int` })
        .from(events)
        .where(and(scope, eq(events.type, 'exposure')))
        .groupBy(events.variationId);
      const opId = sql<string>`${events.payload}->>'operationId'`;
      const rows = await db
        .select({
          operationId: opId,
          variationId: events.variationId,
          failed: sql<number>`count(*) filter (where ${events.type} = 'selector_failed')::int`,
          healed: sql<number>`count(*) filter (where ${events.type} = 'selector_healed')::int`,
          lastSeen: sql<string>`max(${events.ts})`,
          // Seletor/via da cura mais recente.
          lastHealed: sql<{
            healedSelector: string;
            via: string;
          } | null>`(array_agg(json_build_object('healedSelector', ${events.payload}->>'healedSelector', 'via', ${events.payload}->>'via') order by ${events.ts} desc) filter (where ${events.type} = 'selector_healed'))[1]`,
        })
        .from(events)
        .where(and(scope, inArray(events.type, ['selector_failed', 'selector_healed'])))
        .groupBy(opId, events.variationId);
      return {
        exposures: Object.fromEntries(exposures.map((e) => [e.variationId ?? '', e.n])),
        operations: rows.map((r) => ({ ...r, lastSeen: new Date(r.lastSeen).toISOString() })),
      };
    },

    /**
     * Mapa de calor de uma página (`normalizePage`), opcionalmente filtrado por variação (experimentId +
     * variationId ativos na página), dispositivo e período (`from`).
     */
    async heatmap(
      accountId: string,
      f: { url: string; experimentId?: string; variationId?: string; device?: string; from?: Date },
      maxPoints = 200,
    ) {
      const page = normalizePage(f.url);
      const p = events.payload;
      const conds = [eq(events.accountId, accountId), sql`${pageSql(p)} = ${page}`];
      if (f.device) conds.push(sql`${p}->>'device' = ${f.device}`);
      if (f.from) conds.push(gte(events.ts, f.from));
      if (f.experimentId && f.variationId)
        conds.push(sql`${p}->'variations'->>${f.experimentId} = ${f.variationId}`);
      else if (f.experimentId) conds.push(sql`${p}->'variations' ? ${f.experimentId}`);

      const elements = await db
        .select({
          selector: sql<string>`${p}->>'selector'`,
          count: sql<number>`count(*)::int`,
          points: sql<
            [number, number][]
          >`(array_agg(json_build_array((${p}->>'rx')::float, (${p}->>'ry')::float) order by ${events.ts} desc))[1:${sql.raw(String(maxPoints))}]`,
        })
        .from(events)
        .where(and(...conds, eq(events.type, 'click')))
        .groupBy(sql`${p}->>'selector'`)
        .orderBy(desc(sql`count(*)`));

      const depths = await db
        .select({ depth: sql<number>`(${p}->>'depth')::float` })
        .from(events)
        .where(and(...conds, eq(events.type, 'scroll')));
      return {
        page,
        clicks: { total: elements.reduce((t, e) => t + e.count, 0), elements },
        scroll: scrollReached(depths.map((d) => d.depth)),
      };
    },

    /**
     * Experimentos em execução com alocação automática (bandit), de TODAS as contas — manutenção do sistema
     * (job de rebalanceamento), como o expurgo; não é exposta em rota.
     */
    async listBanditExperiments(): Promise<{ accountId: string; id: string }[]> {
      return db
        .select({ accountId: experiments.accountId, id: experiments.id })
        .from(experiments)
        .where(
          and(
            eq(experiments.status, 'running'),
            sql`${experiments.options}->>'allocation' in ('bandit', 'autopilot')`,
          ),
        );
    },

    /** Contas que têm entidades de um tipo — manutenção do sistema (jobs), sem rota exposta. */
    async listAccountsWithEntity(kind: string): Promise<string[]> {
      const rows = await db
        .selectDistinct({ a: entities.accountId })
        .from(entities)
        .where(eq(entities.kind, kind));
      return rows.map((r) => r.a);
    },

    async listEntities<T = unknown>(accountId: string, kind: string): Promise<Entity<T>[]> {
      const rows = await db
        .select()
        .from(entities)
        .where(and(eq(entities.accountId, accountId), eq(entities.kind, kind)))
        .orderBy(desc(entities.updatedAt));
      return rows.map(toEntity<T>);
    },

    async getEntity<T = unknown>(accountId: string, kind: string, id: string): Promise<Entity<T> | null> {
      const [r] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.accountId, accountId), eq(entities.kind, kind), eq(entities.id, id)));
      return r ? toEntity<T>(r) : null;
    },

    /** Cria (sem id) ou substitui (com id da mesma conta e tipo). Devolve o id. */
    async saveEntity(
      accountId: string,
      e: { id?: string; kind: string; name: string; data: unknown; userId?: string },
    ): Promise<string> {
      const now = new Date();
      if (e.id) {
        const r = await db
          .update(entities)
          .set({ name: e.name, data: e.data, updatedAt: now })
          .where(and(eq(entities.accountId, accountId), eq(entities.kind, e.kind), eq(entities.id, e.id)))
          .returning({ id: entities.id });
        if (!r.length) throw new NotFoundError('não encontrado');
        return e.id;
      }
      const id = newId(e.kind.slice(0, 4));
      await db.insert(entities).values({
        id,
        accountId,
        kind: e.kind,
        name: e.name,
        data: e.data,
        createdBy: e.userId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },

    /**
     * Troca atômica: grava `data` só se a entidade não mudou desde `updatedAt` (lido antes). Para quem precisa
     * de exclusão sem trava (ex.: um passo da geração de ideias por vez). Devolve o novo `updatedAt` ou null.
     */
    async swapEntity(
      accountId: string,
      kind: string,
      id: string,
      updatedAt: string,
      data: unknown,
    ): Promise<string | null> {
      // Sempre depois do anterior: duas trocas no mesmo milissegundo não podem gerar a mesma versão.
      const now = new Date(Math.max(Date.now(), Date.parse(updatedAt) + 1));
      const r = await db
        .update(entities)
        .set({ data, updatedAt: now })
        .where(
          and(
            eq(entities.accountId, accountId),
            eq(entities.kind, kind),
            eq(entities.id, id),
            eq(entities.updatedAt, new Date(updatedAt)),
          ),
        )
        .returning({ id: entities.id });
      return r.length ? now.toISOString() : null;
    },

    async deleteEntity(accountId: string, kind: string, id: string): Promise<boolean> {
      const r = await db
        .delete(entities)
        .where(and(eq(entities.accountId, accountId), eq(entities.kind, kind), eq(entities.id, id)))
        .returning({ id: entities.id });
      return r.length > 0;
    },

    async saveRecordingChunk(accountId: string, c: RecordingChunkInput): Promise<void> {
      const { first, last, pages } = chunkSummary(c.events);
      if (!Number.isFinite(first)) return;
      const [cur] = await db
        .select()
        .from(recordings)
        .where(and(eq(recordings.accountId, accountId), eq(recordings.sessionId, c.sessionId)));
      if (cur)
        await db
          .update(recordings)
          .set({
            startedAt: new Date(Math.min(cur.startedAt.getTime(), first)),
            endedAt: new Date(Math.max(cur.endedAt.getTime(), last)),
            pages: mergePages(cur.pages, pages),
            events: cur.events + c.events.length,
          })
          .where(and(eq(recordings.accountId, accountId), eq(recordings.id, cur.id)));
      else
        await db
          .insert(recordings)
          .values({
            id: newId('rec'),
            accountId,
            sessionId: c.sessionId,
            visitorId: c.visitorId,
            startedAt: new Date(first),
            endedAt: new Date(last),
            pages,
            device: c.device,
            vw: c.vw,
            vh: c.vh,
            events: c.events.length,
          })
          .onConflictDoNothing();
      await db.insert(recordingChunks).values({
        id: newId('rch'),
        accountId,
        sessionId: c.sessionId,
        firstTs: new Date(first),
        data: c.events,
      });
    },

    async listRecordings(accountId: string, f: RecordingFilter = {}): Promise<RecordingMeta[]> {
      const conds: SQL[] = [eq(recordings.accountId, accountId)];
      if (f.from) conds.push(gte(recordings.startedAt, f.from));
      if (f.to) conds.push(lte(recordings.startedAt, f.to));
      if (f.device) conds.push(eq(recordings.device, f.device));
      if (f.visitorIds) conds.push(inArray(recordings.visitorId, f.visitorIds.length ? f.visitorIds : ['']));
      const rows = await db
        .select()
        .from(recordings)
        .where(and(...conds))
        .orderBy(desc(recordings.startedAt))
        .limit(f.limit ?? 200);
      return rows.map((r) => ({
        sessionId: r.sessionId,
        visitorId: r.visitorId,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt.toISOString(),
        durationMs: r.endedAt.getTime() - r.startedAt.getTime(),
        pages: r.pages,
        device: r.device,
        vw: r.vw,
        vh: r.vh,
        events: r.events,
      }));
    },

    /** Eventos rrweb da sessão em ordem (todos os blocos). null = sessão sem gravação. */
    async getRecordingEvents(accountId: string, sessionId: string): Promise<unknown[] | null> {
      const rows = await db
        .select({ data: recordingChunks.data })
        .from(recordingChunks)
        .where(and(eq(recordingChunks.accountId, accountId), eq(recordingChunks.sessionId, sessionId)))
        .orderBy(asc(recordingChunks.firstTs));
      if (!rows.length) return null;
      return rows.flatMap((r) => r.data as { timestamp: number }[]).sort((a, b) => a.timestamp - b.timestamp);
    },

    async logActivity(accountId: string, a: ActivityInput, now = Date.now()): Promise<void> {
      const [last] = await this.listActivities(accountId, { limit: 1 });
      if (last && mergeableActivity(last, a, now)) {
        await db
          .update(activities)
          .set({ createdAt: new Date(now), targetName: a.targetName, detail: a.detail ?? null })
          .where(and(eq(activities.accountId, accountId), eq(activities.id, last.id)));
        return;
      }
      await db
        .insert(activities)
        .values({ id: newId('act'), accountId, ...a, detail: a.detail ?? null, createdAt: new Date(now) });
    },

    async listActivities(accountId: string, f: ActivityFilter = {}): Promise<Activity[]> {
      const conds: SQL[] = [eq(activities.accountId, accountId)];
      if (f.userId) conds.push(eq(activities.userId, f.userId));
      if (f.targetType) conds.push(eq(activities.targetType, f.targetType));
      if (f.targetId) conds.push(eq(activities.targetId, f.targetId));
      if (f.before) conds.push(lt(activities.createdAt, f.before));
      const rows = await db
        .select()
        .from(activities)
        .where(and(...conds))
        .orderBy(desc(activities.createdAt))
        .limit(f.limit ?? 50);
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        targetName: r.targetName,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      }));
    },

    async addComment(accountId: string, c: CommentInput): Promise<Comment> {
      const [r] = await db
        .insert(comments)
        .values({ id: newId('cmt'), accountId, ...c })
        .returning();
      return toComment(r!);
    },

    /** Conversa de um alvo, da mais antiga para a mais nova. */
    async listComments(accountId: string, targetType: string, targetId: string): Promise<Comment[]> {
      const rows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.accountId, accountId),
            eq(comments.targetId, targetId),
            eq(comments.targetType, targetType),
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(COMMENTS_PER_TARGET);
      return rows.reverse().map(toComment);
    },

    /** Comentários que mencionam a pessoa, mais recentes primeiro. */
    async listMentions(accountId: string, userId: string, limit = 50): Promise<Comment[]> {
      // ponytail: varre os comentários da conta (sem índice nas menções); tabela de menções se crescer.
      const rows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.accountId, accountId),
            sql`${comments.mentions} @> ${JSON.stringify([{ id: userId }])}::jsonb`,
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(limit);
      return rows.map(toComment);
    },

    async getComment(accountId: string, id: string): Promise<Comment | null> {
      const [r] = await db
        .select()
        .from(comments)
        .where(and(eq(comments.accountId, accountId), eq(comments.id, id)));
      return r ? toComment(r) : null;
    },

    async deleteComment(accountId: string, id: string): Promise<boolean> {
      const r = await db
        .delete(comments)
        .where(and(eq(comments.accountId, accountId), eq(comments.id, id)))
        .returning({ id: comments.id });
      return r.length > 0;
    },

    /** Eventos em ordem (ts, id) a partir de um cursor (exportação incremental). */
    async listEventsPage(accountId: string, f: EventPage): Promise<TrackingEvent[]> {
      const conds: SQL[] = [eq(events.accountId, accountId)];
      if (f.after) {
        const at = new Date(f.after[0]);
        conds.push(or(gt(events.ts, at), and(eq(events.ts, at), gt(events.id, f.after[1])))!);
      }
      if (f.through) {
        const at = new Date(f.through[0]);
        conds.push(or(lt(events.ts, at), and(eq(events.ts, at), lte(events.id, f.through[1])))!);
      }
      if (f.before) conds.push(lt(events.ts, f.before));
      if (f.excludeTypes?.length) conds.push(notInArray(events.type, f.excludeTypes));
      const rows = await db
        .select({ payload: events.payload })
        .from(events)
        .where(and(...conds))
        .orderBy(asc(events.ts), asc(events.id))
        .limit(f.limit);
      return rows.map((r) => r.payload as TrackingEvent);
    },

    async addWebhookDelivery(accountId: string, d: NewDelivery): Promise<void> {
      const now = new Date();
      await db.insert(webhookDeliveries).values({
        ...d,
        accountId,
        nextAt: d.nextAt ? new Date(d.nextAt) : null,
        createdAt: now,
        updatedAt: now,
      });
    },

    /**
     * Atualiza uma entrega. Com `ifNextAt`, só se ainda estiver pendente com esse `next_at` (pegar a vez:
     * duas drenagens simultâneas não entregam a mesma). Devolve se gravou.
     */
    async updateWebhookDelivery(
      accountId: string,
      id: string,
      u: DeliveryUpdate,
      ifNextAt?: string,
    ): Promise<boolean> {
      const conds = [eq(webhookDeliveries.accountId, accountId), eq(webhookDeliveries.id, id)];
      if (ifNextAt !== undefined)
        conds.push(eq(webhookDeliveries.status, 'pending'), eq(webhookDeliveries.nextAt, new Date(ifNextAt)));
      const r = await db
        .update(webhookDeliveries)
        .set({
          status: u.status,
          attempts: u.attempts,
          nextAt: u.nextAt ? new Date(u.nextAt) : null,
          lastStatus: u.lastStatus,
          lastError: u.lastError,
          updatedAt: new Date(),
        })
        .where(and(...conds))
        .returning({ id: webhookDeliveries.id });
      return r.length > 0;
    },

    async getWebhookDelivery(accountId: string, id: string): Promise<WebhookDelivery | null> {
      const [r] = await db
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.accountId, accountId), eq(webhookDeliveries.id, id)));
      return r ? toDelivery(r) : null;
    },

    /** Últimas entregas de um webhook (mais novas primeiro). */
    async listWebhookDeliveries(
      accountId: string,
      webhookId: string,
      limit = 20,
    ): Promise<WebhookDelivery[]> {
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.accountId, accountId), eq(webhookDeliveries.webhookId, webhookId)))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit);
      return rows.map(toDelivery);
    },

    async countWebhookDeliveries(accountId: string, webhookId: string) {
      const rows = await db
        .select({ status: webhookDeliveries.status, n: sql<number>`count(*)::int` })
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.accountId, accountId), eq(webhookDeliveries.webhookId, webhookId)))
        .groupBy(webhookDeliveries.status);
      const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
      return { pending: n('pending'), failed: n('failed') };
    },

    /**
     * Entregas pendentes vencidas, das mais atrasadas para as mais novas. Sem `accountId` = todas as contas
     * (manutenção do sistema, só no job; não exposta em rota).
     */
    async dueWebhookDeliveries(
      now: Date,
      limit: number,
      accountId?: string,
    ): Promise<(WebhookDelivery & { accountId: string })[]> {
      const conds = [eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAt, now)];
      if (accountId) conds.push(eq(webhookDeliveries.accountId, accountId));
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(and(...conds))
        .orderBy(asc(webhookDeliveries.nextAt))
        .limit(limit);
      return rows.map((r) => ({ ...toDelivery(r), accountId: r.accountId }));
    },

    /** Apaga entregas encerradas (entregues ou falhas) antes de `cutoff` — manutenção, todas as contas. */
    async purgeWebhookDeliveries(cutoff: Date): Promise<void> {
      await db
        .delete(webhookDeliveries)
        .where(and(ne(webhookDeliveries.status, 'pending'), lt(webhookDeliveries.updatedAt, cutoff)));
    },

    /**
     * Pedido do titular (LGPD art. 18, GDPR art. 17): apaga eventos, gravações e entregas de webhook pendentes
     * que citam os visitantes. Devolve quantos eventos e gravações saíram.
     */
    async deleteVisitorData(accountId: string, visitorIds: string[]) {
      if (!visitorIds.length) return { events: 0, recordings: 0 };
      const recs = await db
        .delete(recordings)
        .where(and(eq(recordings.accountId, accountId), inArray(recordings.visitorId, visitorIds)))
        .returning({ sessionId: recordings.sessionId });
      if (recs.length)
        await db.delete(recordingChunks).where(
          and(
            eq(recordingChunks.accountId, accountId),
            inArray(
              recordingChunks.sessionId,
              recs.map((r) => r.sessionId),
            ),
          ),
        );
      const evs = await db
        .delete(events)
        .where(and(eq(events.accountId, accountId), inArray(events.visitorId, visitorIds)))
        .returning({ id: events.id });
      for (const v of visitorIds)
        await db
          .delete(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.accountId, accountId),
              sql`strpos(${webhookDeliveries.body}, ${`"visitorId":${JSON.stringify(v)}`}) > 0`,
            ),
          );
      return { events: evs.length, recordings: recs.length };
    },

    async insertPublication(accountId: string, config: PublishedConfig, userId?: string) {
      await db.insert(publications).values({
        id: newId('pub'),
        accountId,
        version: config.version,
        config,
        publishedBy: userId ?? null,
      });
    },
  };
}
export type Repo = ReturnType<typeof createRepo>;
