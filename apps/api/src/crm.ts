import { createRoute, z } from '@hono/zod-openapi';
import {
  CRM_SOURCES,
  CrmConfigSchema,
  type CrmConfig,
  type CrmField,
  type CrmProvider,
  type CrmStatus,
  type Segment,
} from '@abtest/shared';
import { buildProfiles, matchSegment, type ProfileSummary } from './analytics/profiles';
import { forbid, hasRole } from './auth';
import { errors, ErrorSchema, json, Report, security, type Api } from './http';
import type { Repo } from './repo';

// Perfis do CDP → HubSpot / Salesforce (fase 19.1, D-089). Upsert por e-mail, em lotes, a partir de um cursor
// (última visita, id do perfil): cada execução manda só quem mudou desde a anterior. Credenciais ficam na
// entidade interna `crm` (fora das rotas genéricas de entidades) e nunca voltam na API.
// Implementado contra a documentação das APIs (HubSpot CRM v3 batch upsert, Salesforce composite sObject
// collections upsert) e testado com servidor falso; ainda não validado com conta real.

export const CRM_KIND = 'crm';
const STATE_KIND = 'crm-state';
export const CRM_PATHS = ['/integrations/*'];
const PROVIDERS = ['hubspot', 'salesforce'] as const;
const LABEL: Record<CrmProvider, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce' };
/** Perfis por requisição ao CRM (HubSpot aceita até 100 por lote; Salesforce até 200). */
export const CRM_BATCH = 100;
/** Janela dos perfis (eventos lidos para montar os agregados). */
const WINDOW_DAYS = 30;
const TYPES = ['pageview', 'event', 'identify', 'conversion', 'exposure'];
const TIMEOUT_MS = 15_000;
const SF_VERSION = 'v61.0';

/** Endereços das APIs (trocados só nos testes, por um servidor falso). */
export interface CrmBase {
  hubspot?: string;
  salesforce?: string;
}

type State = CrmStatus & { cursor?: [number, string] };
type Row = { email: string; values: Record<string, string | number> };
type Outcome = { ok: number; errors: string[] };

class CrmError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E-mail do perfil: atributo `email` (identify) ou o próprio userId, quando é um e-mail. */
export function emailOf(p: ProfileSummary): string | null {
  for (const v of [p.attributes.email, p.userId]) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (EMAIL.test(s) && s.length <= 254) return s;
  }
  return null;
}

/** Valor de uma origem para um perfil (undefined = atributo ausente, o campo não é mexido). */
function sourceValue(p: ProfileSummary, from: string, segs: string[]): string | number | undefined {
  switch (from as keyof typeof CRM_SOURCES) {
    case 'segments':
      return segs.join(';');
    case 'experiments':
      return Object.entries(p.experiments)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
    case 'sessions':
    case 'pageviews':
    case 'conversions':
      return p[from as 'sessions'];
    case 'revenue':
      return Math.round(p.revenue * 100) / 100;
    case 'firstSeen':
    case 'lastSeen':
      return new Date(p[from as 'lastSeen']).toISOString();
    case 'devices':
      return p.devices.join(';');
    default: {
      const v = p.attributes[from.slice(5)];
      return v === undefined ? undefined : typeof v === 'boolean' ? String(v) : v;
    }
  }
}

export function toRow(
  p: ProfileSummary,
  email: string,
  fields: CrmField[],
  segments: { name: string; data: Segment }[],
): Row {
  const segs = segments.filter((s) => matchSegment(p, s.data)).map((s) => s.name);
  const values: Row['values'] = {};
  for (const f of fields) {
    const v = sourceValue(p, f.from, segs);
    if (v !== undefined) values[f.to] = v;
  }
  return { email, values };
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);
async function bodyText(r: Response) {
  try {
    return short(await r.text());
  } catch {
    return '';
  }
}
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new CrmError(`sem resposta de ${new URL(url).host} (${(e as Error).name})`);
  }
}

/** HubSpot: POST /crm/v3/objects/contacts/batch/upsert com `idProperty: email` (cria ou atualiza). */
async function sendHubspot(cfg: CrmConfig['hubspot'], rows: Row[], base: string): Promise<Outcome> {
  const r = await call(`${base}/crm/v3/objects/contacts/batch/upsert`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      inputs: rows.map((x) => ({
        idProperty: 'email',
        id: x.email,
        // HubSpot recebe os valores como texto (números e datas são convertidos pelo tipo da propriedade).
        properties: {
          ...Object.fromEntries(Object.entries(x.values).map(([k, v]) => [k, String(v)])),
          email: x.email,
        },
      })),
    }),
  });
  if (r.status !== 200 && r.status !== 201 && r.status !== 207)
    throw new CrmError(`HubSpot respondeu ${r.status}: ${await bodyText(r)}`);
  const j = (await r.json().catch(() => ({}))) as {
    results?: unknown[];
    errors?: { message?: string }[];
  };
  return {
    ok: j.results?.length ?? (r.status === 207 ? 0 : rows.length),
    errors: (j.errors ?? []).map((e) => short(e.message ?? 'erro')),
  };
}

/** Salesforce: token por client credentials e PATCH composite/sobjects/<objeto>/<campo de id externo>. */
async function sendSalesforce(cfg: CrmConfig['salesforce'], rows: Row[], base: string): Promise<Outcome> {
  const t = await call(`${base}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret ?? '',
    }).toString(),
  });
  if (t.status !== 200)
    throw new CrmError(`Salesforce recusou as credenciais (${t.status}): ${await bodyText(t)}`);
  const { access_token: token } = (await t.json().catch(() => ({}))) as { access_token?: string };
  if (!token) throw new CrmError('Salesforce não devolveu o token de acesso');
  const r = await call(
    `${base}/services/data/${SF_VERSION}/composite/sobjects/${cfg.object}/${cfg.externalIdField}`,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        allOrNone: false,
        records: rows.map((x) => ({
          attributes: { type: cfg.object },
          ...x.values,
          [cfg.externalIdField]: x.email,
        })),
      }),
    },
  );
  if (r.status !== 200) throw new CrmError(`Salesforce respondeu ${r.status}: ${await bodyText(r)}`);
  const list = (await r.json().catch(() => [])) as { success?: boolean; errors?: { message?: string }[] }[];
  return {
    ok: Array.isArray(list) ? list.filter((x) => x.success).length : 0,
    errors: (Array.isArray(list) ? list : []).flatMap((x) =>
      x.success ? [] : (x.errors ?? [{}]).map((e) => short(e.message ?? 'erro')),
    ),
  };
}

/** Falta algo para sincronizar? Devolve o motivo. */
export function missing(cfg: CrmConfig, provider: CrmProvider): string | null {
  if (provider === 'hubspot') {
    const h = cfg.hubspot;
    if (!h.token) return 'informe o token do app privado do HubSpot';
    if (!h.fields.length) return 'escolha ao menos um campo';
    return null;
  }
  const s = cfg.salesforce;
  if (!s.instanceUrl || !s.clientId || !s.clientSecret) return 'informe o domínio, o client id e o segredo';
  if (!s.externalIdField) return 'informe o campo de ID externo com o e-mail';
  if (!s.fields.length) return 'escolha ao menos um campo';
  return null;
}

export async function loadCrm(repo: Repo, accountId: string) {
  const [e] = await repo.listEntities<CrmConfig>(accountId, CRM_KIND);
  return { id: e?.id, config: CrmConfigSchema.parse(e?.data ?? {}) };
}
async function loadStates(repo: Repo, accountId: string) {
  return repo.listEntities<State>(accountId, STATE_KIND);
}
const emptyStatus = (): CrmStatus => ({ sent: 0, total: 0, failed: 0, remaining: 0, errors: [] });
const publicStatus = ({ cursor: _c, ...s }: State): CrmStatus => s;

/**
 * Uma execução: monta os perfis da janela, pega os que mudaram depois do cursor e manda até `batches` lotes.
 * Erro de transporte ou credencial para na hora e não avança o cursor (a próxima tenta de novo os mesmos).
 */
export async function syncCrm(
  repo: Repo,
  accountId: string,
  provider: CrmProvider,
  opts: { batches: number; base?: CrmBase; now?: number },
): Promise<CrmStatus | { error: string }> {
  const { config } = await loadCrm(repo, accountId);
  const why = missing(config, provider);
  if (why) return { error: why };
  const now = opts.now ?? Date.now();
  const [events, segments, states] = await Promise.all([
    repo.listEvents(accountId, {
      from: new Date(now - WINDOW_DAYS * 86_400_000),
      to: new Date(now),
      types: TYPES,
    }),
    repo.listEntities<Segment>(accountId, 'segment'),
    loadStates(repo, accountId),
  ]);
  const prev = states.find((s) => s.name === provider);
  const cur = prev?.data.cursor;
  const after = (p: ProfileSummary) =>
    !cur || p.lastSeen > cur[0] || (p.lastSeen === cur[0] && p.id > cur[1]);
  const todo = [...buildProfiles(events).values()]
    .flatMap((p) => {
      const email = after(p) && emailOf(p);
      return email ? [{ p, email }] : [];
    })
    .sort((a, b) => a.p.lastSeen - b.p.lastSeen || (a.p.id < b.p.id ? -1 : 1));

  const fields = config[provider].fields;
  const state: State = {
    ...(prev?.data ?? emptyStatus()),
    at: new Date(now).toISOString(),
    ok: true,
    sent: 0,
    failed: 0,
    errors: [],
  };
  let i = 0;
  for (let b = 0; b < opts.batches && i < todo.length; b++) {
    const chunk = todo.slice(i, i + CRM_BATCH);
    const rows = chunk.map(({ p, email }) => toRow(p, email, fields, segments));
    try {
      const out =
        provider === 'hubspot'
          ? await sendHubspot(config.hubspot, rows, opts.base?.hubspot ?? 'https://api.hubapi.com')
          : await sendSalesforce(
              config.salesforce,
              rows,
              opts.base?.salesforce ?? config.salesforce.instanceUrl.replace(/\/$/, ''),
            );
      state.sent += out.ok;
      state.failed += chunk.length - out.ok;
      state.errors.push(...out.errors);
      const last = chunk[chunk.length - 1]!.p;
      state.cursor = [last.lastSeen, last.id];
      i += chunk.length;
    } catch (e) {
      if (!(e instanceof CrmError)) throw e;
      state.ok = false;
      state.errors.push(e.message);
      break;
    }
  }
  state.total = (prev?.data.total ?? 0) + state.sent;
  state.remaining = todo.length - i;
  state.errors = [...new Set(state.errors)].slice(0, 5);
  if (state.failed) state.ok = false;
  await repo.saveEntity(accountId, { id: prev?.id, kind: STATE_KIND, name: provider, data: state });
  return publicStatus(state);
}

/** Job de hora em hora: cada CRM ligado de cada conta, até 10 lotes por execução. */
export async function syncAllCrm(repo: Repo, base?: CrmBase) {
  for (const accountId of await repo.listAccountsWithEntity(CRM_KIND)) {
    const { config } = await loadCrm(repo, accountId).catch(() => ({ config: null }));
    for (const p of PROVIDERS)
      if (config?.[p].enabled)
        await syncCrm(repo, accountId, p, { batches: 10, base }).catch((e) =>
          console.error(`[crm] ${accountId} ${p}`, e),
        );
  }
}

/** Configuração sem os segredos + situação de cada CRM. */
async function view(repo: Repo, accountId: string) {
  const [{ config }, states] = await Promise.all([loadCrm(repo, accountId), loadStates(repo, accountId)]);
  const { token, ...hubspot } = config.hubspot;
  const { clientSecret, ...salesforce } = config.salesforce;
  const status = Object.fromEntries(
    PROVIDERS.map((p) => {
      const s = states.find((x) => x.name === p);
      return [p, s ? publicStatus(s.data) : null];
    }),
  );
  return {
    config: { hubspot, salesforce },
    hasHubspotToken: !!token,
    hasSalesforceSecret: !!clientSecret,
    status,
  };
}

const Provider = z.object({
  provider: z.enum(PROVIDERS).openapi({ param: { name: 'provider', in: 'path' } }),
});

export function crmRoutes(app: Api, repo: Repo, base?: CrmBase) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/integrations/crm',
      tags: ['integrações'],
      security,
      summary:
        'HubSpot e Salesforce: configuração (sem token nem segredo) e situação da última sincronização',
      responses: { 200: json(Report, 'configuração e situação'), ...errors },
    }),
    async (c) => c.json(await view(repo, c.get('user').accountId), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/integrations/crm',
      tags: ['integrações'],
      security,
      summary:
        'Salva a configuração dos CRMs (só owner). Token/segredo omitido mantém o anterior; salvar reenvia todos os perfis na próxima sincronização',
      request: { body: json(CrmConfigSchema, 'configuração') },
      responses: { 200: json(Report, 'salvo'), 400: json(ErrorSchema, 'falta algo para ligar'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'owner')) return forbid(c);
      const body = c.req.valid('json');
      const old = await loadCrm(repo, me.accountId);
      const data: CrmConfig = {
        hubspot: { ...body.hubspot, token: body.hubspot.token || old.config.hubspot.token },
        salesforce: {
          ...body.salesforce,
          clientSecret: body.salesforce.clientSecret || old.config.salesforce.clientSecret,
        },
      };
      for (const p of PROVIDERS) {
        const why = data[p].enabled && missing(data, p);
        if (why) return c.json({ error: `${LABEL[p]}: ${why} antes de ligar.` }, 400);
      }
      await repo.saveEntity(me.accountId, { id: old.id, kind: CRM_KIND, name: 'CRM', data, userId: me.id });
      // Campos ou destino podem ter mudado: a próxima sincronização manda todos os perfis de novo.
      for (const s of await loadStates(repo, me.accountId))
        await repo.saveEntity(me.accountId, {
          id: s.id,
          kind: STATE_KIND,
          name: s.name,
          data: { ...s.data, cursor: undefined, total: 0, remaining: 0 },
        });
      return c.json(await view(repo, me.accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/integrations/crm/{provider}/sync',
      tags: ['integrações'],
      security,
      summary:
        'Sincroniza agora um lote de perfis com e-mail (editor+). `remaining` > 0: chame de novo para o próximo lote',
      request: { params: Provider },
      responses: { 200: json(Report, 'situação'), 400: json(ErrorSchema, 'não configurado'), ...errors },
    }),
    async (c) => {
      const me = c.get('user');
      if (!hasRole(me, 'editor')) return forbid(c);
      const { provider } = c.req.valid('param');
      const r = await syncCrm(repo, me.accountId, provider, { batches: 1, base });
      return 'error' in r ? c.json({ error: `${LABEL[provider]}: ${r.error}.` }, 400) : c.json(r, 200);
    },
  );
}
