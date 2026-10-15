import { ExperimentSchema, type Experiment, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import { and, asc, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
  accounts,
  events,
  experiments,
  experimentVersions,
  goals,
  projects,
  publications,
  users,
  variations,
} from './schema';

import { hashPassword, newId } from './crypto';

export { hashPassword, newId, verifyPassword } from './crypto';

export type Role = 'owner' | 'editor' | 'viewer';
export type User = typeof users.$inferSelect;

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
}

/** Página para o mapa de calor: origin + caminho, sem query, hash nem barra final. */
export function normalizePage(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, '');
  } catch {
    return url.split('#')[0]!.split('?')[0]!.replace(/\/$/, '');
  }
}

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
        variations: vars.map((v) => ({
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

    async createUser(
      accountId: string,
      u: { email: string; name: string; password: string; role?: Role; canPublishJs?: boolean },
    ): Promise<User> {
      const [row] = await db
        .insert(users)
        .values({
          id: newId('usr'),
          accountId,
          email: u.email.toLowerCase(),
          name: u.name,
          role: u.role ?? 'editor',
          canPublishJs: u.canPublishJs ?? false,
          passwordHash: await hashPassword(u.password),
        })
        .returning();
      return row!;
    },

    /** Login é o único acesso sem conta conhecida: o e-mail é único no sistema. */
    async findUserByEmail(email: string): Promise<User | undefined> {
      const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      return row;
    },

    async getUser(accountId: string, id: string): Promise<User | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.accountId, accountId), eq(users.id, id)));
      return row;
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
      return db
        .select({
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

    async getAccountSettings(accountId: string): Promise<AccountSettings> {
      const [row] = await db
        .select({ heatmapSampleRate: accounts.heatmapSampleRate })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      return { heatmapSampleRate: row?.heatmapSampleRate ?? null };
    },

    async updateAccountSettings(accountId: string, s: AccountSettings): Promise<void> {
      await db
        .update(accounts)
        .set({ heatmapSampleRate: s.heatmapSampleRate })
        .where(eq(accounts.id, accountId));
    },

    /**
     * Retenção: apaga eventos recebidos antes de `cutoff`. Manutenção do sistema (todas as contas) —
     * única consulta sem filtro de conta, de propósito; não é exposta em rota.
     */
    async purgeEventsBefore(cutoff: Date): Promise<void> {
      await db.delete(events).where(lt(events.receivedAt, cutoff));
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
            payload: e,
            ts: new Date(e.ts),
          })),
        )
        .onConflictDoNothing(); // eventId repetido (reenvio do beacon) é ignorado
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
     * Mapa de calor de uma página (URL sem query/hash/barra final), opcionalmente filtrado por
     * variação (experimentId + variationId ativos na página) e dispositivo.
     */
    async heatmap(
      accountId: string,
      f: { url: string; experimentId?: string; variationId?: string; device?: string },
      maxPoints = 200,
    ) {
      const page = normalizePage(f.url);
      const p = events.payload;
      const conds = [
        eq(events.accountId, accountId),
        sql`regexp_replace(split_part(split_part(${p}->>'url', '#', 1), '?', 1), '/$', '') = ${page}`,
      ];
      if (f.device) conds.push(sql`${p}->>'device' = ${f.device}`);
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
