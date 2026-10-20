import { createRoute, z } from '@hono/zod-openapi';
import {
  ExportConfigSchema,
  HEATMAP_EVENT_TYPES,
  nextExportAt,
  type ExportConfig,
  type ExportDestination,
  type TrackingEvent,
} from '@abtest/shared';
import { forbid, hasRole } from './auth';
import { newId } from './crypto';
import { googleAccessToken, parseServiceAccount } from './google';
import { errors, ErrorSchema, json, Report, security, type Api } from './http';
import type { EventCursor, Repo } from './repo';
import { loadReport } from './routes/report';
import { sha256Hex, signV4 } from './sigv4';

// Exportação agendada de dados (fase 19.4, D-092). Configuração na entidade interna `export` (credenciais só
// escrita, fora das rotas genéricas), estado em `export-state` (cursor, execução em andamento, última execução,
// próximo horário). Cada passo exporta um lote a partir do cursor (ts, id) e grava o estado: o job de hora em
// hora faz alguns passos por conta e o botão "Exportar agora" faz um por requisição (a tela repete), então
// nenhuma invocação passa do orçamento do Worker grátis. Destinos implementados pela documentação e testados
// com servidores falsos; não validados com contas reais de AWS, R2, GCS ou BigQuery.

export const EXPORT_KIND = 'export';
const STATE_KIND = 'export-state';
const FILE_KIND = 'export-file';
export const EXPORT_PATHS = ['/exports', '/exports/*'];

/** Eventos só entram depois de 15 min (beacons atrasados ainda chegam no lote certo). */
export const LAG_MS = 15 * 60_000;
/** Vez de um passo (invocação que morreu no meio libera depois disto). */
const LEASE_MS = 60_000;
/** Eventos por passo, por destino (BigQuery recomenda até 500 linhas por insertAll). */
export const BATCH: Record<ExportDestination, number> = { csv: 5000, s3: 2000, bigquery: 500 };
/** Passos por conta em cada rodada do job. */
const CRON_STEPS = 5;
const MAX_FILES = 50;
const REPORT_DAYS = 90;
const TIMEOUT_MS = 20_000;
const BQ_SCOPE = 'https://www.googleapis.com/auth/bigquery.insertdata';

/** Endereços trocados só nos testes (servidores falsos). */
export interface ExportBase {
  s3?: string;
  bigquery?: string;
  oauth?: string;
}

interface Run {
  id: string;
  startedAt: string;
  /** Exporta eventos com ts antes disto. */
  until: number;
  phase: 'events' | 'reports';
  events: number;
  reports: number;
  manual: boolean;
}
interface LastRun extends Omit<Run, 'until' | 'phase'> {
  finishedAt: string;
  ok: boolean;
  error: string | null;
}
interface State {
  cursor: EventCursor | null;
  run: Run | null;
  last: LastRun | null;
  nextAt: number | null;
  leaseUntil: number;
}
interface FileData {
  kind: 'events' | 'reports';
  rows: number;
  /** Eventos: faixa do cursor (recriado na hora de baixar, nada de evento guardado em dobro). */
  after?: EventCursor | null;
  through?: EventCursor;
  heatmap?: boolean;
  /** Relatório: o CSV pronto (pequeno: testes × metas × variações). */
  csv?: string;
}

class ExportError extends Error {}
const BOM = String.fromCharCode(0xfeff);

// ---------- CSV ----------

export const EVENT_COLUMNS = [
  'event_id',
  'ts',
  'type',
  'visitor_id',
  'session_id',
  'experiment_id',
  'variation_id',
  'goal_id',
  'value',
  'url',
  'payload',
] as const;
export const REPORT_COLUMNS = [
  'snapshot_at',
  'period_from',
  'period_to',
  'experiment_id',
  'experiment_key',
  'experiment_name',
  'goal_id',
  'goal_key',
  'primary_goal',
  'variation_id',
  'variation_key',
  'variation_name',
  'visitors',
  'conversions',
  'conversion_rate',
  'revenue',
  'lift',
  'prob_beat_control',
  'verdict',
] as const;
type Values = Record<string, string | number | boolean | null>;

export function eventRow(e: TrackingEvent): Values {
  const x = e as TrackingEvent & Partial<Record<'experimentId' | 'variationId' | 'goalId', string>>;
  const value = 'value' in e && typeof e.value === 'number' ? e.value : null;
  return {
    event_id: e.eventId,
    ts: new Date(e.ts).toISOString(),
    type: e.type,
    visitor_id: e.visitorId,
    session_id: e.sessionId ?? null,
    experiment_id: x.experimentId ?? null,
    variation_id: x.variationId ?? null,
    goal_id: x.goalId ?? null,
    value,
    url: e.url,
    payload: JSON.stringify(e),
  };
}

/**
 * CSV (RFC 4180, campos entre aspas). `guard` (download para planilha): texto que começa com = + - @ ganha
 * um apóstrofo na frente, para o Excel não executar fórmula vinda de um visitante.
 */
export function toCsv(columns: readonly string[], rows: Values[], guard = false): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (guard && typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join(
    '\r\n',
  );
}

/** Relatório dos testes em execução (mesma conta da tela de relatório, últimos 90 dias). */
async function reportRows(repo: Repo, accountId: string, now: number): Promise<Values[]> {
  const exps = (await repo.loadAllExperiments(accountId)).filter((e) => e.status === 'running');
  const out: Values[] = [];
  for (const exp of exps) {
    // ponytail: todos os testes num passo (CPU do relatório); um passo por teste se a conta tiver muitos.
    const r = await loadReport(repo, accountId, exp, { days: REPORT_DAYS, to: new Date(now).toISOString() });
    for (const g of r.goals)
      for (const a of g.arms) {
        const v = exp.variations.find((x) => x.id === a.variationId);
        out.push({
          snapshot_at: new Date(now).toISOString(),
          period_from: new Date(now - REPORT_DAYS * 86_400_000).toISOString(),
          period_to: new Date(now).toISOString(),
          experiment_id: exp.id,
          experiment_key: exp.key,
          experiment_name: exp.name,
          goal_id: g.goalId,
          goal_key: g.goalKey,
          primary_goal: g.primary,
          variation_id: a.variationId,
          variation_key: v?.key ?? '',
          variation_name: v?.name ?? '',
          visitors: a.visitors,
          conversions: a.conversions,
          conversion_rate: a.rate,
          revenue: a.revenue,
          lift: a.lift,
          prob_beat_control: a.probBeatControl,
          verdict: a.verdict,
        });
      }
  }
  return out;
}

// ---------- Destinos ----------

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 300);
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ExportError(`sem resposta de ${new URL(url).host} (${(e as Error).name})`);
  }
}
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** PUT de um objeto no S3 (ou compatível) assinado com SigV4. */
async function putS3(cfg: ExportConfig['s3'], key: string, body: string, base?: string) {
  const path = `${cfg.prefix}${key}`.replace(/^\/+/, '');
  // AWS: estilo virtual-hosted; endpoint próprio (R2, GCS, MinIO): estilo caminho.
  const url = base
    ? `${base}/${cfg.bucket}/${path}`
    : cfg.endpoint
      ? `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${path}`
      : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${path}`;
  const hash = await sha256Hex(body);
  const headers = await signV4(
    {
      method: 'PUT',
      url,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'x-amz-content-sha256': hash },
      payloadHash: hash,
    },
    {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey ?? '',
      region: cfg.region,
      service: 's3',
    },
  );
  const { host: _h, ...send } = headers; // fetch põe o host
  const r = await call(url, { method: 'PUT', headers: send, body });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new ExportError(`S3 respondeu ${r.status}${code ? ` (${code})` : `: ${short(text)}`}`);
  }
}

/** BigQuery `tabledata.insertAll` (streaming), com `insertId` para o BigQuery descartar repetidos. */
async function insertBigQuery(
  cfg: ExportConfig['bigquery'],
  table: string,
  rows: { insertId: string; json: Values }[],
  token: string,
  base?: string,
) {
  const url = `${base ?? 'https://bigquery.googleapis.com'}/bigquery/v2/projects/${encodeURIComponent(cfg.projectId)}/datasets/${encodeURIComponent(cfg.dataset)}/tables/${encodeURIComponent(table)}/insertAll`;
  const r = await call(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ skipInvalidRows: false, ignoreUnknownValues: false, rows }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    error?: { message?: string };
    insertErrors?: { index: number; errors?: { message?: string; location?: string }[] }[];
  };
  if (!r.ok) throw new ExportError(`BigQuery respondeu ${r.status}: ${short(j.error?.message ?? '')}`);
  const e = j.insertErrors?.[0];
  if (e) {
    const m = e.errors?.find((x) => x.message && x.message !== 'Stopped') ?? e.errors?.[0];
    throw new ExportError(
      `BigQuery recusou ${j.insertErrors!.length} linha(s): ${short(`${m?.location ? `${m.location}: ` : ''}${m?.message ?? 'erro'}`)}`,
    );
  }
}

class Sink {
  private token: string | null = null;
  constructor(
    private repo: Repo,
    private accountId: string,
    private cfg: ExportConfig,
    private base: ExportBase = {},
  ) {}

  private async bqToken() {
    const sa = parseServiceAccount(this.cfg.bigquery.serviceAccount ?? '');
    if (!sa) throw new ExportError('chave da conta de serviço inválida');
    try {
      return (this.token ??= await googleAccessToken(sa, BQ_SCOPE, {
        tokenUrl: this.base.oauth,
        timeoutMs: TIMEOUT_MS,
      }));
    } catch (e) {
      throw new ExportError((e as Error).message);
    }
  }

  async events(
    list: TrackingEvent[],
    range: { after: EventCursor | null; through: EventCursor },
    runId: string,
  ) {
    const { destination } = this.cfg;
    const first = list[0]!;
    if (destination === 'csv')
      return this.file(`eventos-${day(first.ts)}-${runId.slice(-6)}.csv`, {
        kind: 'events',
        rows: list.length,
        ...range,
        heatmap: this.cfg.heatmap,
      });
    if (destination === 's3')
      // Chave = primeiro evento do lote: repetir o mesmo lote (passo que morreu) sobrescreve o mesmo objeto.
      return putS3(
        this.cfg.s3,
        `events/dt=${day(first.ts)}/${first.ts}-${first.eventId}.csv`,
        toCsv(EVENT_COLUMNS, list.map(eventRow)),
        this.base.s3,
      );
    return insertBigQuery(
      this.cfg.bigquery,
      this.cfg.bigquery.eventsTable,
      list.map((e) => ({ insertId: e.eventId, json: eventRow(e) })),
      await this.bqToken(),
      this.base.bigquery,
    );
  }

  async reports(rows: Values[], runId: string, now: number) {
    const { destination } = this.cfg;
    const csv = () => toCsv(REPORT_COLUMNS, rows);
    if (destination === 'csv')
      return this.file(`relatorios-${day(now)}-${runId.slice(-6)}.csv`, {
        kind: 'reports',
        rows: rows.length,
        csv: csv(),
      });
    if (destination === 's3')
      return putS3(this.cfg.s3, `reports/dt=${day(now)}/${runId}.csv`, csv(), this.base.s3);
    return insertBigQuery(
      this.cfg.bigquery,
      this.cfg.bigquery.reportsTable,
      rows.map((r) => ({
        insertId: `${runId}:${r.experiment_id}:${r.goal_id}:${r.variation_id}`,
        json: r,
      })),
      await this.bqToken(),
      this.base.bigquery,
    );
  }

  /** CSV para baixar no editor: só os metadados (eventos) ou o relatório pronto; guarda os últimos 50. */
  private async file(name: string, data: FileData) {
    await this.repo.saveEntity(this.accountId, { kind: FILE_KIND, name, data });
    const files = await this.repo.listEntities(this.accountId, FILE_KIND);
    for (const f of files.slice(MAX_FILES)) await this.repo.deleteEntity(this.accountId, FILE_KIND, f.id);
  }
}

// ---------- Configuração e estado ----------

/** Falta algo para exportar? Devolve o motivo. */
export function missing(c: ExportConfig): string | null {
  if (!c.events && !c.reports) return 'escolha o que exportar (eventos e/ou relatórios)';
  if (c.destination === 's3') {
    if (!c.s3.bucket) return 'informe o bucket';
    if (!c.s3.accessKeyId || !c.s3.secretAccessKey) return 'informe a chave de acesso e o segredo';
  }
  if (c.destination === 'bigquery') {
    if (!c.bigquery.projectId || !c.bigquery.dataset) return 'informe o projeto e o dataset';
    if (!c.bigquery.serviceAccount) return 'cole o JSON da chave da conta de serviço';
    if (!parseServiceAccount(c.bigquery.serviceAccount))
      return 'o JSON não é uma chave de conta de serviço (client_email e private_key)';
  }
  return null;
}

async function loadConfig(repo: Repo, accountId: string) {
  const [e] = await repo.listEntities<ExportConfig>(accountId, EXPORT_KIND);
  return { id: e?.id, config: e ? ExportConfigSchema.parse(e.data) : null };
}
async function loadState(repo: Repo, accountId: string) {
  const [e] = await repo.listEntities<State>(accountId, STATE_KIND);
  return e ?? null;
}
const emptyState = (): State => ({ cursor: null, run: null, last: null, nextAt: null, leaseUntil: 0 });
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

function publicState(s: State | null) {
  return {
    running: s?.run
      ? { startedAt: s.run.startedAt, phase: s.run.phase, events: s.run.events, manual: s.run.manual }
      : null,
    last: s?.last ?? null,
    nextAt: iso(s?.nextAt),
    /** Até onde os eventos já foram exportados. */
    exportedUntil: iso(s?.cursor?.[0]),
  };
}

/** Configuração sem as credenciais, situação e arquivos para baixar (CSV). */
async function view(repo: Repo, accountId: string) {
  const [{ config }, state, files] = await Promise.all([
    loadConfig(repo, accountId),
    loadState(repo, accountId),
    repo.listEntities<FileData>(accountId, FILE_KIND),
  ]);
  const c = config ?? ExportConfigSchema.parse({});
  const { secretAccessKey, ...s3 } = c.s3;
  const { serviceAccount, ...bigquery } = c.bigquery;
  return {
    config: { ...c, s3, bigquery },
    configured: !!config,
    hasS3Secret: !!secretAccessKey,
    serviceAccountEmail: parseServiceAccount(serviceAccount ?? '')?.client_email ?? null,
    status: publicState(state?.data ?? null),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.data.kind,
      rows: f.data.rows,
      createdAt: f.createdAt,
    })),
  };
}

/**
 * Um passo da exportação: começa uma execução (se venceu o horário ou se é manual), pega a vez no estado
 * (troca atômica, D-086), exporta um lote de eventos ou o relatório e grava o cursor. Erro do destino encerra
 * a execução com o motivo e tenta de novo em 1 h, do mesmo cursor (nada se perde, nada é pulado).
 */
export async function exportStep(
  repo: Repo,
  accountId: string,
  opts: { manual?: boolean; now?: number; base?: ExportBase } = {},
): Promise<{ started: boolean; running: boolean } | { error: string }> {
  const now = opts.now ?? Date.now();
  const { config } = await loadConfig(repo, accountId);
  if (!config) return { error: 'configure a exportação antes' };
  if (!opts.manual && !config.enabled) return { started: false, running: false };
  const why = missing(config);
  if (why) return { error: why };
  const entity = await loadState(repo, accountId);
  if (!entity) return { error: 'configure a exportação antes' };
  const st: State = { ...emptyState(), ...entity.data };
  if (st.leaseUntil > now) return { started: false, running: !!st.run };
  let started = false;
  if (!st.run) {
    if (!opts.manual && (st.nextAt === null || now < st.nextAt)) return { started: false, running: false };
    const until = now - LAG_MS;
    st.run = {
      id: newId('exp'),
      startedAt: new Date(now).toISOString(),
      until,
      phase: config.events ? 'events' : 'reports',
      events: 0,
      reports: 0,
      manual: !!opts.manual,
    };
    // Primeira exportação: começa pelo período da frequência (o histórico anterior não vai).
    st.cursor ??= [until - (config.frequency === 'weekly' ? 7 : 1) * 86_400_000, ''];
    started = true;
  }
  const version = await repo.swapEntity(accountId, STATE_KIND, entity.id, entity.updatedAt, {
    ...st,
    leaseUntil: now + LEASE_MS,
  });
  if (!version) return { started: false, running: true };

  const run = st.run;
  const sink = new Sink(repo, accountId, config, opts.base);
  let done = false;
  try {
    if (run.phase === 'events') {
      const limit = BATCH[config.destination];
      const batch = await repo.listEventsPage(accountId, {
        after: st.cursor,
        before: new Date(run.until),
        excludeTypes: config.heatmap ? [] : HEATMAP_EVENT_TYPES,
        limit,
      });
      const last = batch[batch.length - 1];
      if (last) {
        const through: EventCursor = [last.ts, last.eventId];
        const list = batch.filter((e) => !e.qa);
        if (list.length) await sink.events(list, { after: st.cursor, through }, run.id);
        st.cursor = through;
        run.events += list.length;
      }
      if (batch.length < limit) {
        if (config.reports) run.phase = 'reports';
        else done = true;
      }
    } else {
      const rows = await reportRows(repo, accountId, now);
      if (rows.length) await sink.reports(rows, run.id, now);
      run.reports = rows.length;
      done = true;
    }
  } catch (e) {
    if (!(e instanceof ExportError)) console.error('[exports]', accountId, e);
    st.last = finish(run, now, e instanceof ExportError ? e.message : 'erro interno na exportação');
    st.run = null;
    st.nextAt = config.enabled ? Math.min(now + 3_600_000, nextExportAt(config, now)) : null;
  }
  if (done) {
    st.last = finish(run, now, null);
    st.run = null;
    st.nextAt = config.enabled ? nextExportAt(config, now) : null;
  }
  // Se a configuração mudou no meio (PUT grava o estado), este resultado é descartado.
  await repo.swapEntity(accountId, STATE_KIND, entity.id, version, { ...st, leaseUntil: 0 });
  return { started, running: !!st.run };
}

function finish(run: Run, now: number, error: string | null): LastRun {
  const { until: _u, phase: _p, ...rest } = run;
  return { ...rest, finishedAt: new Date(now).toISOString(), ok: !error, error };
}

/** Job de hora em hora: contas com exportação ligada e vencida (ou em andamento), alguns passos cada. */
export async function exportAll(repo: Repo, base?: ExportBase) {
  for (const accountId of await repo.listAccountsWithEntity(EXPORT_KIND))
    for (let i = 0; i < CRON_STEPS; i++) {
      const r = await exportStep(repo, accountId, { base }).catch((e) => {
        console.error(`[exports] ${accountId}`, e);
        return null;
      });
      if (!r || 'error' in r || !r.running) break;
    }
}

// ---------- Rotas ----------

export function exportRoutes(app: Api, repo: Repo, base?: ExportBase) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/exports',
      tags: ['integrações'],
      security,
      summary: 'Exportação agendada: configuração (sem credenciais), situação e arquivos CSV para baixar',
      responses: { 200: json(Report, 'configuração, situação e arquivos'), ...errors },
    }),
    async (c) => c.json(await view(repo, c.get('user').accountId), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/exports',
      tags: ['integrações'],
      security,
      summary:
        'Salva a exportação (só owner). Segredo/chave omitidos mantêm os guardados; trocar o destino recomeça do período da frequência',
      request: { body: json(ExportConfigSchema, 'configuração') },
      responses: { 200: json(Report, 'salvo'), 400: json(ErrorSchema, 'falta algo para ligar'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const body = c.req.valid('json');
      const old = await loadConfig(repo, me.accountId);
      const data: ExportConfig = {
        ...body,
        s3: { ...body.s3, secretAccessKey: body.s3.secretAccessKey || old.config?.s3.secretAccessKey },
        bigquery: {
          ...body.bigquery,
          serviceAccount: body.bigquery.serviceAccount || old.config?.bigquery.serviceAccount,
        },
      };
      if (body.bigquery.serviceAccount && !parseServiceAccount(body.bigquery.serviceAccount))
        return c.json({ error: 'BigQuery: o JSON não é uma chave de conta de serviço.' }, 400);
      const why = data.enabled && missing(data);
      if (why) return c.json({ error: `Exportação: ${why} antes de ligar.` }, 400);
      await repo.saveEntity(me.accountId, {
        id: old.id,
        kind: EXPORT_KIND,
        name: 'Exportação',
        data,
        userId: me.id,
      });
      const st = await loadState(repo, me.accountId);
      const moved = old.config?.destination !== data.destination;
      const next: State = {
        ...emptyState(),
        ...st?.data,
        // Destino novo: começa do zero (outro lugar não tem o que já foi); a execução em andamento é descartada.
        ...(moved ? { cursor: null, run: null } : {}),
        nextAt: data.enabled ? nextExportAt(data, Date.now()) : null,
        leaseUntil: 0,
      };
      await repo.saveEntity(me.accountId, { id: st?.id, kind: STATE_KIND, name: 'Exportação', data: next });
      return c.json(await view(repo, me.accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/exports/run',
      tags: ['integrações'],
      security,
      summary:
        'Exportar agora (editor+): um passo por chamada (um lote de eventos ou o relatório). `status.running` = chame de novo',
      responses: { 200: json(Report, 'situação'), 400: json(ErrorSchema, 'não configurado'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'editor')) return forbid(c);
      const r = await exportStep(repo, me.accountId, { manual: true, base });
      if ('error' in r) return c.json({ error: `Exportação: ${r.error}.` }, 400);
      return c.json({ started: r.started, ...(await view(repo, me.accountId)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/exports/files/{id}',
      tags: ['integrações'],
      security,
      summary: 'Baixa um CSV exportado (eventos são lidos de novo do banco: some quando a retenção apaga)',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 200: { description: 'text/csv' }, ...errors },
    }),
    async (c) => {
      const { accountId } = c.get('user');
      const f = await repo.getEntity<FileData>(accountId, FILE_KIND, c.req.valid('param').id);
      if (!f) return c.json({ error: 'arquivo não encontrado' }, 404);
      let body: string;
      if (f.data.kind === 'reports') body = f.data.csv ?? '';
      else {
        const list = await repo.listEventsPage(accountId, {
          after: f.data.after ?? null,
          through: f.data.through,
          excludeTypes: f.data.heatmap ? [] : HEATMAP_EVENT_TYPES,
          limit: BATCH.csv,
        });
        body = toCsv(EVENT_COLUMNS, list.filter((e) => !e.qa).map(eventRow), true);
      }
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="${f.name.replace(/[^\w.-]/g, '_')}"`);
      // BOM: o Excel abre acentos certo.
      return c.body(`${BOM}${body}`) as never;
    },
  );
}
