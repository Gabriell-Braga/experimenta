// Repositório para Cloudflare D1 (SQLite). Mesmo contrato de `createRepo` (Postgres/Drizzle), com SQL próprio:
// toda consulta de tenant filtra por account_id. Schema em migrations-d1/.
import {
  ExperimentSchema,
  type Experiment,
  type Goal,
  type PublishedConfig,
  type TrackingEvent,
} from '@abtest/shared';
import { hashPassword, newId } from './crypto';
import {
  chunkSummary,
  EVENT_LIMIT,
  mergePages,
  NotFoundError,
  normalizePage,
  scrollReached,
  type ExperimentRecord,
  type Repo,
  type Role,
  type User,
} from './repo';
import { newSession, type EditSession, type SessionStore } from './sessions';

/** Subconjunto da API do D1 que usamos (permite testar com node:sqlite). */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<{ results?: unknown[] }[]>;
}

type Row = Record<string, unknown>;
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const date = (v: unknown) => new Date(Number(v));

const toUser = (r: Row): User => ({
  id: r.id as string,
  accountId: r.account_id as string,
  email: r.email as string,
  name: r.name as string,
  role: r.role as Role,
  canPublishJs: !!r.can_publish_js,
  passwordHash: r.password_hash as string,
  createdAt: date(r.created_at),
});
const toProject = (r: Row) => ({
  id: r.id as string,
  accountId: r.account_id as string,
  name: r.name as string,
  siteUrl: r.site_url as string,
  createdAt: date(r.created_at),
});

export function createD1Repo(d1: D1Like): Repo {
  const q = (sql: string, ...v: unknown[]) => d1.prepare(sql).bind(...v);
  const all = async <T = Row>(sql: string, ...v: unknown[]) => (await q(sql, ...v).all<T>()).results;
  const first = <T = Row>(sql: string, ...v: unknown[]) => q(sql, ...v).first<T>();

  /**
   * Várias leituras numa ida só ao banco. O Worker pode rodar longe do D1 (cada ida custa ~100+ ms),
   * então agrupar leituras é o que mais pesa na latência.
   */
  const reads = async (...stmts: D1Stmt[]) =>
    (await d1.batch(stmts)).map((r) => (r as { results: Row[] }).results ?? []);

  const toRecord = (row: Row, vars: Row[], gs: Row[]): ExperimentRecord => ({
    projectId: row.project_id as string,
    editorUrl: row.editor_url as string,
    updatedAt: date(row.updated_at),
    experiment: ExperimentSchema.parse({
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      traffic: row.traffic,
      segmentation: json(row.segmentation),
      antiFlicker: json(row.anti_flicker),
      variations: vars.map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        weight: v.weight,
        operations: json(v.operations),
        customCSS: v.custom_css,
        customJS: v.custom_js,
        ...(v.redirect ? { redirect: json(v.redirect) } : {}),
      })),
      goals: gs.map((g) => json<Goal>(g.definition)),
    }),
  });

  async function loadExperiment(accountId: string, id: string): Promise<ExperimentRecord | null> {
    const [rows = [], vars = [], gs = []] = await reads(
      q('SELECT * FROM experiments WHERE account_id = ? AND id = ?', accountId, id),
      q(
        'SELECT * FROM variations WHERE account_id = ? AND experiment_id = ? ORDER BY position',
        accountId,
        id,
      ),
      q(
        'SELECT definition FROM goals WHERE account_id = ? AND experiment_id = ? ORDER BY position',
        accountId,
        id,
      ),
    );
    const row = rows[0];
    return row ? toRecord(row, vars, gs) : null;
  }

  /** Todos os experimentos da conta com 3 consultas (não 3 por experimento). */
  async function loadAllRecords(accountId: string): Promise<ExperimentRecord[]> {
    const [exps = [], vars = [], gs = []] = await reads(
      q('SELECT * FROM experiments WHERE account_id = ? ORDER BY created_at', accountId),
      q('SELECT * FROM variations WHERE account_id = ? ORDER BY position', accountId),
      q('SELECT experiment_id, definition FROM goals WHERE account_id = ? ORDER BY position', accountId),
    );
    const by = (list: Row[]) => {
      const m = new Map<string, Row[]>();
      for (const r of list)
        m.set(r.experiment_id as string, [...(m.get(r.experiment_id as string) ?? []), r]);
      return m;
    };
    const vm = by(vars);
    const gm = by(gs);
    return exps.map((e) => toRecord(e, vm.get(e.id as string) ?? [], gm.get(e.id as string) ?? []));
  }

  return {
    async ping() {
      await first('SELECT 1 AS ok');
      return true;
    },

    async createAccount(name: string, id = newId('acc')) {
      await q('INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)', id, name, Date.now()).run();
      return { id, name };
    },

    async createUser(accountId, u) {
      const user: User = {
        id: newId('usr'),
        accountId,
        email: u.email.toLowerCase(),
        name: u.name,
        role: u.role ?? 'editor',
        canPublishJs: u.canPublishJs ?? false,
        passwordHash: await hashPassword(u.password),
        createdAt: new Date(),
      };
      await q(
        'INSERT INTO users (id, account_id, email, name, role, can_publish_js, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        user.id,
        accountId,
        user.email,
        user.name,
        user.role,
        user.canPublishJs ? 1 : 0,
        user.passwordHash,
        user.createdAt.getTime(),
      ).run();
      return user;
    },

    async findUserByEmail(email) {
      const r = await first('SELECT * FROM users WHERE email = ?', email.toLowerCase());
      return r ? toUser(r) : undefined;
    },

    async getUser(accountId, id) {
      const r = await first('SELECT * FROM users WHERE account_id = ? AND id = ?', accountId, id);
      return r ? toUser(r) : undefined;
    },

    async createProject(accountId, p) {
      const row = { id: newId('prj'), accountId, name: p.name, siteUrl: p.siteUrl, createdAt: new Date() };
      await q(
        'INSERT INTO projects (id, account_id, name, site_url, created_at) VALUES (?, ?, ?, ?, ?)',
        row.id,
        accountId,
        row.name,
        row.siteUrl,
        row.createdAt.getTime(),
      ).run();
      return row;
    },

    async listProjects(accountId) {
      return (await all('SELECT * FROM projects WHERE account_id = ? ORDER BY created_at', accountId)).map(
        toProject,
      );
    },

    async getProject(accountId, id) {
      const r = await first('SELECT * FROM projects WHERE account_id = ? AND id = ?', accountId, id);
      return r ? toProject(r) : undefined;
    },

    getExperiment: loadExperiment,

    async listExperiments(accountId) {
      const rows = await all(
        `SELECT e.id, e.key, e.name, e.status, e.project_id, e.editor_url, e.updated_at, e.traffic,
           (SELECT count(*) FROM variations v WHERE v.experiment_id = e.id AND v.account_id = e.account_id) AS variations
         FROM experiments e WHERE e.account_id = ? ORDER BY e.updated_at DESC`,
        accountId,
      );
      return rows.map((r) => ({
        id: r.id as string,
        key: r.key as string,
        name: r.name as string,
        status: r.status as Experiment['status'],
        projectId: r.project_id as string,
        editorUrl: r.editor_url as string,
        updatedAt: date(r.updated_at),
        traffic: Number(r.traffic),
        variations: Number(r.variations),
      }));
    },

    /** D1 não tem transação interativa: lê e valida antes, depois grava tudo num `batch` (atômico). */
    async saveExperiment(accountId, input) {
      const exp = ExperimentSchema.parse(input.experiment);
      const [projects = [], existings = [], dups = [], lasts = []] = await reads(
        q('SELECT id FROM projects WHERE account_id = ? AND id = ?', accountId, input.projectId),
        q('SELECT account_id, created_at FROM experiments WHERE id = ?', exp.id),
        q(
          'SELECT id FROM experiments WHERE account_id = ? AND key = ? AND id <> ?',
          accountId,
          exp.key,
          exp.id,
        ),
        q(
          'SELECT max(version) AS v FROM experiment_versions WHERE account_id = ? AND experiment_id = ?',
          accountId,
          exp.id,
        ),
      );
      const [project, existing, dup, last] = [projects[0], existings[0], dups[0], lasts[0]];
      if (!project) throw new NotFoundError('projeto não encontrado');
      if (existing && existing.account_id !== accountId)
        throw new NotFoundError('experimento não encontrado');
      if (dup) throw new Error('chave de experimento já usada nesta conta');
      const version = ((last?.v as number | null) ?? 0) + 1;
      const now = Date.now();
      const stmts: D1Stmt[] = [
        q(
          `INSERT INTO experiments (id, account_id, project_id, key, name, status, traffic, segmentation, anti_flicker, editor_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, key = excluded.key, name = excluded.name,
             status = excluded.status, traffic = excluded.traffic, segmentation = excluded.segmentation,
             anti_flicker = excluded.anti_flicker, editor_url = excluded.editor_url, updated_at = excluded.updated_at
           WHERE experiments.account_id = excluded.account_id`,
          exp.id,
          accountId,
          input.projectId,
          exp.key,
          exp.name,
          exp.status,
          exp.traffic,
          JSON.stringify(exp.segmentation),
          JSON.stringify(exp.antiFlicker),
          input.editorUrl,
          (existing?.created_at as number | undefined) ?? now,
          now,
        ),
        q('DELETE FROM variations WHERE account_id = ? AND experiment_id = ?', accountId, exp.id),
        q('DELETE FROM goals WHERE account_id = ? AND experiment_id = ?', accountId, exp.id),
        ...exp.variations.map((v, i) =>
          q(
            'INSERT INTO variations (id, account_id, experiment_id, key, name, position, weight, operations, custom_css, custom_js, redirect) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            v.id,
            accountId,
            exp.id,
            v.key,
            v.name,
            i,
            v.weight,
            JSON.stringify(v.operations),
            v.customCSS,
            v.customJS,
            v.redirect ? JSON.stringify(v.redirect) : null,
          ),
        ),
        ...exp.goals.map((g, i) =>
          q(
            'INSERT INTO goals (id, account_id, experiment_id, key, position, definition) VALUES (?, ?, ?, ?, ?, ?)',
            g.id,
            accountId,
            exp.id,
            g.key,
            i,
            JSON.stringify(g),
          ),
        ),
        q(
          'INSERT INTO experiment_versions (id, account_id, experiment_id, version, snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          newId('ver'),
          accountId,
          exp.id,
          version,
          JSON.stringify({ experiment: exp, editorUrl: input.editorUrl }),
          input.userId ?? null,
          now,
        ),
      ];
      await d1.batch(stmts);
      return version;
    },

    async deleteExperiment(accountId, id) {
      const r = await first('SELECT id FROM experiments WHERE account_id = ? AND id = ?', accountId, id);
      if (!r) return false;
      // Sem depender de PRAGMA foreign_keys: apaga os filhos explicitamente.
      await d1.batch(
        ['variations', 'goals', 'experiment_versions']
          .map((t) => q(`DELETE FROM ${t} WHERE account_id = ? AND experiment_id = ?`, accountId, id))
          .concat(q('DELETE FROM experiments WHERE account_id = ? AND id = ?', accountId, id)),
      );
      return true;
    },

    async listVersions(accountId, experimentId) {
      const rows = await all(
        'SELECT version, created_by, created_at FROM experiment_versions WHERE account_id = ? AND experiment_id = ? ORDER BY version DESC',
        accountId,
        experimentId,
      );
      return rows.map((r) => ({
        version: r.version as number,
        createdBy: (r.created_by as string | null) ?? null,
        createdAt: date(r.created_at),
      }));
    },

    async getVersion(accountId, experimentId, version) {
      const r = await first(
        'SELECT snapshot FROM experiment_versions WHERE account_id = ? AND experiment_id = ? AND version = ?',
        accountId,
        experimentId,
        version,
      );
      return r ? json<{ experiment: Experiment; editorUrl: string }>(r.snapshot) : undefined;
    },

    loadAllRecords,

    async loadAllExperiments(accountId) {
      return (await loadAllRecords(accountId)).map((r) => r.experiment);
    },

    async lastPublication(accountId) {
      const r = await first(
        'SELECT * FROM publications WHERE account_id = ? ORDER BY version DESC LIMIT 1',
        accountId,
      );
      return r
        ? {
            id: r.id as string,
            accountId,
            version: r.version as number,
            config: json<PublishedConfig>(r.config),
            publishedBy: (r.published_by as string | null) ?? null,
            publishedAt: date(r.published_at),
          }
        : undefined;
    },

    async accountExists(id) {
      return !!(await first('SELECT id FROM accounts WHERE id = ?', id));
    },

    async getAccountSettings(accountId) {
      const row = await first<{ heatmap_sample_rate: number | null }>(
        'SELECT heatmap_sample_rate FROM accounts WHERE id = ?',
        accountId,
      );
      return { heatmapSampleRate: row?.heatmap_sample_rate ?? null };
    },

    async updateAccountSettings(accountId, s) {
      await q(
        'UPDATE accounts SET heatmap_sample_rate = ? WHERE id = ?',
        s.heatmapSampleRate,
        accountId,
      ).run();
    },

    async purgeEventsBefore(cutoff) {
      await d1.batch([
        q('DELETE FROM events WHERE received_at < ?', cutoff.getTime()),
        q('DELETE FROM recording_chunks WHERE received_at < ?', cutoff.getTime()),
        q('DELETE FROM recordings WHERE ended_at < ?', cutoff.getTime()),
      ]);
    },

    async insertEvents(accountId, list: TrackingEvent[]) {
      if (!list.length) return;
      const now = Date.now();
      await d1.batch(
        list.map((e) =>
          q(
            'INSERT OR IGNORE INTO events (id, account_id, type, experiment_id, variation_id, visitor_id, session_id, page, payload, ts, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            e.eventId,
            accountId,
            e.type,
            'experimentId' in e ? e.experimentId : null,
            'variationId' in e ? e.variationId : null,
            e.visitorId,
            e.sessionId ?? null,
            normalizePage(e.url),
            JSON.stringify(e),
            e.ts,
            now,
          ),
        ),
      );
    },

    async listEvents(accountId, f = {}): Promise<TrackingEvent[]> {
      // D1 aceita no máximo 100 parâmetros por consulta: lista grande de visitantes vai em lotes.
      if (f.visitorIds && f.visitorIds.length > 80) {
        const parts: TrackingEvent[] = [];
        for (let i = 0; i < f.visitorIds.length; i += 80)
          parts.push(
            ...(await this.listEvents(accountId, { ...f, visitorIds: f.visitorIds.slice(i, i + 80) })),
          );
        const sign = f.order === 'desc' ? -1 : 1;
        return parts.sort((x, y) => sign * (x.ts - y.ts)).slice(0, f.limit ?? EVENT_LIMIT);
      }
      const conds = ['account_id = ?'];
      const args: unknown[] = [accountId];
      const add = (sql: string, ...v: unknown[]) => {
        conds.push(sql);
        args.push(...v);
      };
      if (f.types?.length) add(`type IN (${f.types.map(() => '?').join(', ')})`, ...f.types);
      if (f.from) add('ts >= ?', f.from.getTime());
      if (f.to) add('ts <= ?', f.to.getTime());
      if (f.experimentId) add('experiment_id = ?', f.experimentId);
      if (f.sessionId) add('session_id = ?', f.sessionId);
      if (f.visitorIds) {
        const ids = f.visitorIds.length ? f.visitorIds : [''];
        add(`visitor_id IN (${ids.map(() => '?').join(', ')})`, ...ids);
      }
      if (f.page) add('page = ?', f.page);
      const rows = await all<{ payload: string }>(
        `SELECT payload FROM events WHERE ${conds.join(' AND ')} ORDER BY ts ${f.order === 'desc' ? 'DESC' : 'ASC'} LIMIT ?`,
        ...args,
        f.limit ?? EVENT_LIMIT,
      );
      return rows.map((r) => json<TrackingEvent>(r.payload));
    },

    async experimentHealth(accountId, experimentId) {
      const exposures = await all<{ variation_id: string | null; n: number }>(
        "SELECT variation_id, count(*) AS n FROM events WHERE account_id = ? AND experiment_id = ? AND type = 'exposure' GROUP BY variation_id",
        accountId,
        experimentId,
      );
      // Ordenado do mais recente: o primeiro selector_healed de cada operação é a cura mais recente.
      const rows = await all<{ type: string; variation_id: string | null; ts: number; payload: string }>(
        "SELECT type, variation_id, ts, payload FROM events WHERE account_id = ? AND experiment_id = ? AND type IN ('selector_failed', 'selector_healed') ORDER BY ts DESC",
        accountId,
        experimentId,
      );
      const ops = new Map<
        string,
        {
          operationId: string;
          variationId: string | null;
          failed: number;
          healed: number;
          lastSeen: string;
          lastHealed: { healedSelector: string; via: string } | null;
        }
      >();
      for (const r of rows) {
        const p = json<{ operationId: string; healedSelector?: string; via?: string }>(r.payload);
        const k = `${p.operationId}|${r.variation_id}`;
        let o = ops.get(k);
        if (!o)
          ops.set(
            k,
            (o = {
              operationId: p.operationId,
              variationId: r.variation_id,
              failed: 0,
              healed: 0,
              lastSeen: new Date(r.ts).toISOString(),
              lastHealed: null,
            }),
          );
        if (r.type === 'selector_failed') o.failed++;
        else {
          o.healed++;
          o.lastHealed ??= { healedSelector: p.healedSelector ?? '', via: p.via ?? '' };
        }
      }
      return {
        exposures: Object.fromEntries(exposures.map((e) => [e.variation_id ?? '', Number(e.n)])),
        operations: [...ops.values()],
      };
    },

    async heatmap(accountId, f, maxPoints = 200) {
      const page = normalizePage(f.url);
      const conds = ['account_id = ?', 'page = ?'];
      const args: unknown[] = [accountId, page];
      if (f.device) {
        conds.push("json_extract(payload, '$.device') = ?");
        args.push(f.device);
      }
      if (f.experimentId) {
        // Chave entre aspas no caminho JSON: ids podem ter caracteres especiais.
        conds.push(f.variationId ? 'json_extract(payload, ?) = ?' : 'json_extract(payload, ?) IS NOT NULL');
        args.push(`$.variations."${f.experimentId.replace(/"/g, '')}"`);
        if (f.variationId) args.push(f.variationId);
      }
      const where = conds.join(' AND ');
      // ponytail: agrega em memória (pontos mais recentes por seletor); materializar com volume real.
      const clicks = await all<{ payload: string }>(
        `SELECT payload FROM events WHERE ${where} AND type = 'click' ORDER BY ts DESC`,
        ...args,
      );
      const bySel = new Map<string, { selector: string; count: number; points: [number, number][] }>();
      for (const c of clicks) {
        const p = json<{ selector: string; rx: number; ry: number }>(c.payload);
        let e = bySel.get(p.selector);
        if (!e) bySel.set(p.selector, (e = { selector: p.selector, count: 0, points: [] }));
        e.count++;
        if (e.points.length < maxPoints) e.points.push([p.rx, p.ry]);
      }
      const elements = [...bySel.values()].sort((a, b) => b.count - a.count);
      const depths = await all<{ d: number }>(
        `SELECT json_extract(payload, '$.depth') AS d FROM events WHERE ${where} AND type = 'scroll'`,
        ...args,
      );
      return {
        page,
        clicks: { total: clicks.length, elements },
        scroll: scrollReached(depths.map((x) => Number(x.d))),
      };
    },

    async saveRecordingChunk(accountId, c) {
      const { first: t0, last: t1, pages } = chunkSummary(c.events);
      if (!Number.isFinite(t0)) return;
      const cur = await first<{
        id: string;
        started_at: number;
        ended_at: number;
        pages: string;
        events: number;
      }>(
        'SELECT id, started_at, ended_at, pages, events FROM recordings WHERE account_id = ? AND session_id = ?',
        accountId,
        c.sessionId,
      );
      const now = Date.now();
      await d1.batch([
        cur
          ? q(
              'UPDATE recordings SET started_at = ?, ended_at = ?, pages = ?, events = ? WHERE account_id = ? AND id = ?',
              Math.min(Number(cur.started_at), t0),
              Math.max(Number(cur.ended_at), t1),
              JSON.stringify(mergePages(json<string[]>(cur.pages), pages)),
              Number(cur.events) + c.events.length,
              accountId,
              cur.id,
            )
          : q(
              'INSERT OR IGNORE INTO recordings (id, account_id, session_id, visitor_id, started_at, ended_at, pages, device, vw, vh, events, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              newId('rec'),
              accountId,
              c.sessionId,
              c.visitorId,
              t0,
              t1,
              JSON.stringify(pages),
              c.device,
              c.vw,
              c.vh,
              c.events.length,
              now,
            ),
        q(
          'INSERT INTO recording_chunks (id, account_id, session_id, first_ts, data, received_at) VALUES (?, ?, ?, ?, ?, ?)',
          newId('rch'),
          accountId,
          c.sessionId,
          t0,
          JSON.stringify(c.events),
          now,
        ),
      ]);
    },

    async listRecordings(accountId, f = {}) {
      const conds = ['account_id = ?'];
      const args: unknown[] = [accountId];
      const add = (sql: string, ...v: unknown[]) => {
        conds.push(sql);
        args.push(...v);
      };
      if (f.from) add('started_at >= ?', f.from.getTime());
      if (f.to) add('started_at <= ?', f.to.getTime());
      if (f.device) add('device = ?', f.device);
      if (f.visitorIds) {
        // ponytail: D1 limita parâmetros; filtro por visitante cobre até 80 visitantes (perfil/identidade).
        const ids = (f.visitorIds.length ? f.visitorIds : ['']).slice(0, 80);
        add(`visitor_id IN (${ids.map(() => '?').join(', ')})`, ...ids);
      }
      const rows = await all(
        `SELECT * FROM recordings WHERE ${conds.join(' AND ')} ORDER BY started_at DESC LIMIT ?`,
        ...args,
        f.limit ?? 200,
      );
      return rows.map((r) => ({
        sessionId: r.session_id as string,
        visitorId: r.visitor_id as string,
        startedAt: date(r.started_at).toISOString(),
        endedAt: date(r.ended_at).toISOString(),
        durationMs: Number(r.ended_at) - Number(r.started_at),
        pages: json<string[]>(r.pages),
        device: r.device as string,
        vw: Number(r.vw),
        vh: Number(r.vh),
        events: Number(r.events),
      }));
    },

    async getRecordingEvents(accountId, sessionId) {
      const rows = await all<{ data: string }>(
        'SELECT data FROM recording_chunks WHERE account_id = ? AND session_id = ? ORDER BY first_ts',
        accountId,
        sessionId,
      );
      if (!rows.length) return null;
      return rows
        .flatMap((r) => json<{ timestamp: number }[]>(r.data))
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    async insertPublication(accountId, config, userId) {
      await q(
        'INSERT INTO publications (id, account_id, version, config, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId('pub'),
        accountId,
        config.version,
        JSON.stringify(config),
        userId ?? null,
        Date.now(),
      ).run();
    },
  };
}

/** Sessões de edição no D1 (isolates do Worker não compartilham memória). */
export function createD1SessionStore(d1: D1Like, now = () => Date.now()): SessionStore {
  return {
    async create(accountId, appOrigin) {
      const s = newSession(accountId, appOrigin, now());
      await d1
        .prepare('INSERT INTO edit_sessions (token, account_id, app_origin, expires_at) VALUES (?, ?, ?, ?)')
        .bind(s.token, s.accountId, s.appOrigin, s.expiresAt)
        .run();
      return s;
    },
    async get(token) {
      const r = await d1
        .prepare(
          'SELECT token, account_id, app_origin, expires_at FROM edit_sessions WHERE token = ? AND expires_at > ?',
        )
        .bind(token, now())
        .first<{ token: string; account_id: string; app_origin: string; expires_at: number }>();
      if (!r) return undefined;
      const s: EditSession = {
        token: r.token,
        accountId: r.account_id,
        appOrigin: r.app_origin,
        expiresAt: r.expires_at,
      };
      return s;
    },
  };
}
