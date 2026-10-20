import { ExperimentSchema, type Experiment } from '@abtest/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'abt-token';
/** Última conta usada: o login volta para ela (multi-conta). */
const ACCOUNT_KEY = 'abt-account';

export type Role = 'owner' | 'editor' | 'viewer';
export interface AccountRef {
  id: string;
  name: string;
  role: Role;
}

export interface Me {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: Role;
  canPublishJs: boolean;
  /** Contas de que a pessoa é membro (vem do /me; não vem no login). */
  accounts?: AccountRef[];
  /** Login em duas etapas ativado (vem do /me). */
  totpEnabled?: boolean;
  /** A conta exige duas etapas e a pessoa ainda não ativou: só a tela de configuração funciona. */
  totpRequired?: boolean;
}
export interface Project {
  id: string;
  name: string;
  siteUrl: string;
}
export interface ExperimentSummary {
  id: string;
  key: string;
  name: string;
  status: string;
  editorUrl: string;
  updatedAt: string;
  traffic: number;
  variations: number;
  type: string;
}
export interface ExperimentRecord {
  experiment: Experiment;
  projectId: string;
  editorUrl: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const logout = () => localStorage.removeItem(TOKEN_KEY);
/** Sair de verdade: encerra a sessão na API (o token para de valer) e limpa o local. */
export async function signOut() {
  await api('/sessions/current', { method: 'DELETE' }).catch(() => undefined);
  logout();
}
/** A conta passou a exigir duas etapas no meio do uso: o App recarrega o /me e mostra a configuração. */
export const TOTP_REQUIRED = 'abt:totp-required';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  // "Failed to fetch" = sem resposta legível: rede caiu ou o Worker foi encerrado (ex.: limite de CPU, 503 sem CORS).
  const res = await fetch(`${API_URL}${path}`, { ...init, headers }).catch(() => {
    throw new ApiError(0, 'A API não respondeu (rede ou limite do servidor). Tente de novo.');
  });
  if (res.status === 401 && !path.startsWith('/auth/')) logout();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (body.code === 'totp_required') dispatchEvent(new Event(TOTP_REQUIRED));
    throw new ApiError(res.status, body.error ?? `erro ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface Session {
  token: string;
  user: Me;
}
function startSession(r: Session): Me {
  localStorage.setItem(TOKEN_KEY, r.token);
  localStorage.setItem(ACCOUNT_KEY, r.user.accountId);
  return r.user;
}

/** Login: entra direto ou, para quem tem duas etapas, devolve o desafio para `loginTotp`. */
export async function login(email: string, password: string): Promise<Me | { challenge: string }> {
  const accountId = localStorage.getItem(ACCOUNT_KEY) ?? undefined;
  const r = await api<Session | { mfa: 'totp'; challenge: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, accountId }),
  });
  return 'challenge' in r ? { challenge: r.challenge } : startSession(r);
}
/** 2ª etapa: código do app autenticador ou código de recuperação. */
export const loginTotp = async (challenge: string, code: string) =>
  startSession(
    await api<Session>('/auth/login/totp', { method: 'POST', body: JSON.stringify({ challenge, code }) }),
  );
/** Volta do SSO (`#sso=<token>` na URL): guarda o token e limpa a URL. Devolve o erro do IdP, se houver. */
export function takeSsoResult(): string | null {
  const h = new URLSearchParams(location.hash.slice(1));
  const token = h.get('sso');
  const error = h.get('sso_error');
  if (!token && !error) return null;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  history.replaceState(null, '', location.pathname + location.search);
  return error;
}

/** Troca de conta / conta nova: novo token; a página recarrega para nenhuma tela ficar com dado da conta anterior. */
export const switchAccount = async (id: string) =>
  startSession(await api<Session>(`/accounts/${encodeURIComponent(id)}/switch`, { method: 'POST' }));
export const createAccount = async (name: string, siteUrl: string) =>
  startSession(await api<Session>('/accounts', { method: 'POST', body: JSON.stringify({ name, siteUrl }) }));

export interface Member extends Me {
  createdAt: string;
}
export interface Invite {
  id: string;
  email: string;
  role: Role;
  canPublishJs: boolean;
  expiresAt: string;
  createdAt: string;
}
export const team = {
  members: () => api<Member[]>('/members'),
  update: (id: string, access: { role: Role; canPublishJs: boolean }) =>
    api(`/members/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(access) }),
  remove: (id: string) => api<void>(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  invites: () => api<Invite[]>('/invites'),
  invite: (email: string, role: Role, canPublishJs: boolean) =>
    api<{ id: string; token: string; expiresAt: string }>('/invites', {
      method: 'POST',
      body: JSON.stringify({ email, role, canPublishJs }),
    }),
  revoke: (id: string) => api<void>(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Link que o owner copia e manda para a pessoa (sem serviço de e-mail, ver D-070). */
export const inviteLink = (token: string) =>
  `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;
export const inviteInfo = (token: string) =>
  api<{ accountName: string; email: string; role: Role; hasUser: boolean; hasTotp: boolean }>(
    `/auth/invites/${encodeURIComponent(token)}`,
  );
export const acceptInvite = async (token: string, body: { password: string; name?: string; code?: string }) =>
  startSession(
    await api<Session>(`/auth/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

// ---------- Segurança de acesso (duas etapas, sessões, SSO) ----------
export interface LoginSession {
  id: string;
  accountId: string;
  accountName: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}
export interface SsoConfig {
  enabled: boolean;
  protocol: 'oidc' | 'saml';
  domains: string[];
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  ssoUrl?: string;
  idpEntityId?: string;
  idpCert?: string;
}
export interface SsoState {
  config: SsoConfig | null;
  hasClientSecret: boolean;
  available: SsoConfig['protocol'][];
}
const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const securityApi = {
  totp: () => api<{ enabled: boolean; recoveryCodesLeft: number; required: boolean }>('/me/totp'),
  setup: () => post<{ secret: string; uri: string }>('/me/totp/setup'),
  enable: (code: string) => post<{ recoveryCodes: string[] }>('/me/totp/enable', { code }),
  disable: (password: string, code: string) => post<{ ok: boolean }>('/me/totp/disable', { password, code }),
  recoveryCodes: (code: string) => post<{ recoveryCodes: string[] }>('/me/totp/recovery-codes', { code }),
  sessions: () => api<LoginSession[]>('/sessions'),
  revoke: (id: string) => api<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOthers: () => api<{ revoked: number }>('/sessions', { method: 'DELETE' }),
  account: () =>
    api<{ requireTotp: boolean; withoutTotp: { id: string; name: string; email: string }[] }>(
      '/account/security',
    ),
  setRequireTotp: (requireTotp: boolean) =>
    api<{ requireTotp: boolean }>('/account/security', {
      method: 'PUT',
      body: JSON.stringify({ requireTotp }),
    }),
  sso: () => api<SsoState>('/account/sso'),
  saveSso: (c: SsoConfig) => api<SsoState>('/account/sso', { method: 'PUT', body: JSON.stringify(c) }),
};

/** Linha do histórico de atividades (auditoria). */
export interface ActivityItem {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  detail: string | null;
  createdAt: string;
}
export const listActivities = (f: { userId?: string; type?: string; targetId?: string; before?: string }) =>
  query<{ items: ActivityItem[]; next: string | null }>('/activities', f);

/** Comentários e @menções (fase 16.6). Texto puro: renderizar sempre como texto, nunca como HTML. */
export type CommentTarget = 'experiment' | 'popup' | 'survey' | 'idea';
export interface CommentItem {
  id: string;
  targetType: CommentTarget;
  targetId: string;
  targetName: string;
  userId: string;
  userName: string;
  body: string;
  mentions: { id: string; name: string }[];
  createdAt: string;
}
/** Avisa o menu (contador de menções) que algo mudou. */
export const MENTIONS_CHANGED = 'abt:mentions';
export const comments = {
  list: (targetType: CommentTarget, targetId: string) =>
    query<CommentItem[]>('/comments', { targetType, targetId }),
  mentions: () => api<CommentItem[]>('/comments/mentions'),
  add: (c: { targetType: CommentTarget; targetId: string; body: string; mentions: string[] }) =>
    api<CommentItem>('/comments', { method: 'POST', body: JSON.stringify(c) }),
  remove: (id: string) => api(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const me = () => api<Me>('/me');
export const listProjects = () => api<Project[]>('/projects');
export const listExperiments = () => api<ExperimentSummary[]>('/experiments');

export async function getExperiment(id: string): Promise<ExperimentRecord> {
  const r = await api<ExperimentRecord>(`/experiments/${encodeURIComponent(id)}`);
  return { ...r, experiment: ExperimentSchema.parse(r.experiment) };
}

export function saveExperiment(rec: ExperimentRecord, isNew = false): Promise<{ version: number }> {
  return api(isNew ? '/experiments' : `/experiments/${encodeURIComponent(rec.experiment.id)}`, {
    method: isNew ? 'POST' : 'PUT',
    body: JSON.stringify(rec),
  });
}

export interface AccountSettings {
  /** Fração 0..1; null = padrão do servidor. */
  heatmapSampleRate: number | null;
  /** Publicação passa por aprovação (owner ou "publica JS"). */
  requireApproval?: boolean;
}
export const getAccountSettings = () => api<AccountSettings>('/account/settings');
export const saveAccountSettings = (s: AccountSettings) =>
  api<AccountSettings>('/account/settings', { method: 'PUT', body: JSON.stringify(s) });

/** Resultado da publicação: versão no ar ou, em conta com aprovação, pedido aguardando (202). */
export type PublishResult = { version: number } | { pending: true; requestId: string };
/** Avisa o menu (contador de aprovações) que os pedidos mudaram. */
export const APPROVALS_CHANGED = 'abt:approvals';
const approvalsChanged = () => dispatchEvent(new Event(APPROVALS_CHANGED));

export async function publish(): Promise<PublishResult> {
  const r = await api<PublishResult>('/publish', { method: 'POST' });
  approvalsChanged();
  return r;
}

export const PENDING_TEXT =
  'Enviado para aprovação: vai ao ar quando um owner aprovar (Configurar → Aprovações).';
/** Texto do aviso depois de publicar: `ok` quando foi ao ar, o de pedido quando ficou aguardando aprovação. */
export const publishedText = (r: PublishResult, ok: string) => ('pending' in r ? PENDING_TEXT : ok);

export interface PublishRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  requestedBy: { id: string; name: string };
  decidedBy?: { id: string; name: string };
  decidedAt?: string;
  comment?: string;
  version?: number;
  createdAt: string;
  updatedAt: string;
}
const decided = <T>(p: Promise<T>) => p.finally(approvalsChanged);
export const approvals = {
  list: () => api<PublishRequest[]>('/publish-requests'),
  request: (note: string) =>
    decided(api<PublishRequest>('/publish-requests', { method: 'POST', body: JSON.stringify({ note }) })),
  approve: (id: string, comment: string) =>
    decided(
      api<{ version: number }>(`/publish-requests/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
    ),
  reject: (id: string, comment: string) =>
    decided(
      api<PublishRequest>(`/publish-requests/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
    ),
};
/** Quem aprova: owner ou membro com "publica JS" (mesma regra da API). */
export const canApprove = (u: Me) => u.role === 'owner' || (u.role === 'editor' && u.canPublishJs);

export async function createEditSession(): Promise<string> {
  return (await api<{ token: string }>('/edit-sessions', { method: 'POST' })).token;
}

/** URL do site com o token de edição (o snippet entra em modo edição só dentro do iframe). */
export function frameUrl(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set('abt_edit', token);
  return u.href;
}

export interface Health {
  exposures: Record<string, number>;
  operations: {
    operationId: string;
    variationId: string | null;
    failed: number;
    healed: number;
    lastSeen: string;
    lastHealed: { healedSelector: string; via: string } | null;
  }[];
}
export const getHealth = (id: string) => api<Health>(`/experiments/${encodeURIComponent(id)}/health`);

export interface Conflict {
  experimentId: string;
  name: string;
  status: string;
  selectors: string[];
}
export const getConflicts = (id: string) =>
  api<Conflict[]>(`/experiments/${encodeURIComponent(id)}/conflicts`);

export interface VersionInfo {
  version: number;
  createdBy: string | null;
  createdAt: string;
}
export const listVersions = (id: string) =>
  api<VersionInfo[]>(`/experiments/${encodeURIComponent(id)}/versions`);
export const restoreVersion = (id: string, v: number) =>
  api<{ version: number }>(`/experiments/${encodeURIComponent(id)}/versions/${v}/restore`, {
    method: 'POST',
  });

/** Link de pré-visualização do rascunho de uma variação (17.3). O token só vem na criação. */
export interface PreviewLink {
  id: string;
  variationId: string;
  variationName: string;
  expiresAt: string;
  createdAt: string;
}
const previewPath = (id: string) => `/experiments/${encodeURIComponent(id)}/previews`;
export const previews = {
  list: (id: string) => api<PreviewLink[]>(previewPath(id)),
  create: (id: string, variationId: string, hours: number) =>
    api<{ id: string; url: string; expiresAt: string }>(previewPath(id), {
      method: 'POST',
      body: JSON.stringify({ variationId, hours }),
    }),
  revoke: (id: string, pid: string) =>
    api<void>(`${previewPath(id)}/${encodeURIComponent(pid)}`, { method: 'DELETE' }),
};

/** Agendamento de iniciar/pausar (17.4). `at` em ISO UTC; a tela mostra no fuso do navegador. */
export interface Schedule {
  id: string;
  experimentId: string;
  experimentName: string;
  action: 'start' | 'pause';
  at: string;
  createdBy: string;
}
const schedulePath = (id: string) => `/experiments/${encodeURIComponent(id)}/schedules`;
export const schedules = {
  list: (experimentId?: string) =>
    api<Schedule[]>(`/schedules${experimentId ? `?experimentId=${encodeURIComponent(experimentId)}` : ''}`),
  create: (id: string, action: Schedule['action'], at: string) =>
    api<{ id: string }>(schedulePath(id), { method: 'POST', body: JSON.stringify({ action, at }) }),
  update: (id: string, sid: string, action: Schedule['action'], at: string) =>
    api<{ id: string }>(`${schedulePath(id)}/${encodeURIComponent(sid)}`, {
      method: 'PUT',
      body: JSON.stringify({ action, at }),
    }),
  remove: (id: string, sid: string) =>
    api<void>(`${schedulePath(id)}/${encodeURIComponent(sid)}`, { method: 'DELETE' }),
};

export interface HeatmapFilters {
  experimentId?: string;
  variationId?: string;
  device?: 'desktop' | 'tablet' | 'mobile';
}
export function getHeatmap(url: string, f: HeatmapFilters) {
  const q = new URLSearchParams({ url });
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  return api<import('./components/HeatmapPanel').HeatmapResult>(`/heatmap?${q}`);
}

export const setStatus = (id: string, status: string) =>
  api<{ version: number }>(`/experiments/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const duplicateExperiment = (id: string) =>
  api<{ id: string }>(`/experiments/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
export const deleteExperiment = (id: string) =>
  api<void>(`/experiments/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** GET autenticado com query (filtros dos relatórios); valores vazios são omitidos. */
export function query<T>(path: string, params: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return api<T>(s ? `${path}?${s}` : path);
}

export interface Overview {
  totals: {
    visitors: number;
    sessions: number;
    pageviews: number;
    events: number;
    conversions: number;
    revenue: number;
  };
  byType: Record<string, number>;
  series: { day: string; pageviews: number; events: number; visitors: number; sessions: number }[];
  topPages: { key: string; count: number }[];
  topEvents: { key: string; count: number }[];
  devices: Record<string, number>;
  referrers: { key: string; count: number }[];
}
/** Painel geral (GET /analytics/dashboard). */
export interface Insight {
  id: string;
  kind: string;
  severity: 'critical' | 'warning' | 'good' | 'info';
  title: string;
  detail: string;
  link: { view: string; params?: Record<string, string> };
}
export interface Dashboard {
  insights: Insight[];
  traffic: Overview['totals'] & {
    deltas: Record<'visitors' | 'sessions' | 'pageviews' | 'conversions' | 'revenue', number | null>;
    series: { day: string; visitors: number }[];
    devices: Record<string, number>;
  };
  experiments: {
    id: string;
    name: string;
    type: string;
    visitors: number;
    goal: string | null;
    leader: { name: string; lift: number | null; probBeatControl: number | null; verdict: Verdict } | null;
    srm: boolean;
    daysRemaining: number | null;
  }[];
  behavior: { rage: number; dead: number; avgScroll: number | null; worstPage: string | null };
  forms: { landed: number; interacted: number; submitted: number; completion: number | null };
  engage: { views: number; clicks: number; submits: number; surveyResponses: number };
  profiles: { identified: number; multiDevice: number };
}
export const getDashboard = (days: number) => query<Dashboard>('/analytics/dashboard', { days });
/** Receita por canal (D-080): linhas por canal, origem e campanha; números por variação (uma fora de teste). */
export type Channel = 'direct' | 'organic' | 'paid' | 'social' | 'email' | 'referral' | 'campaign';
export interface AttributionRow {
  key: string;
  channel: Channel;
  conversions: number[];
  revenue: number[];
}
export type AttributionDim = 'channel' | 'source' | 'campaign';
export interface Attribution {
  from: string;
  to: string;
  windowDays: number;
  conversions: number;
  revenue: number;
  first: Record<AttributionDim, AttributionRow[]>;
  last: Record<AttributionDim, AttributionRow[]>;
  /** Painel: nomes de eventos do período (para escolher a conversão). */
  events?: { key: string; count: number }[];
  /** Experimento: variações na ordem das posições das linhas. */
  variations?: { id: string; name: string }[];
  goalKey?: string;
}
export const getAttribution = (days: number, event?: string) =>
  query<Attribution>('/analytics/attribution', { days, event });
export const getExperimentAttribution = (id: string, p: { days: number; goalId?: string }) =>
  query<Attribution>(`/experiments/${encodeURIComponent(id)}/attribution`, p);
export const getOverview = (days: number) => query<Overview>('/analytics/overview', { days });
export const listEvents = (
  p: { type?: string; visitorId?: string; sessionId?: string; limit?: number } = {},
) => query<import('@abtest/shared').TrackingEvent[]>('/events', p);

export type Verdict = 'winner' | 'loser' | 'leading' | 'inconclusive' | 'baseline';
export interface ArmStats {
  variationId: string;
  rate: number;
  rateLow: number;
  rateHigh: number;
  lift: number | null;
  liftLow: number | null;
  liftHigh: number | null;
  probBeatControl: number | null;
  probBest: number;
  expectedLoss: number;
  pValue: number | null;
  verdict: Verdict;
  /** Teste sequencial ligado: p sempre válido e intervalo da melhoria (null no controle). */
  sequential?: { pValue: number; liftLow: number | null; liftHigh: number | null } | null;
}
export interface ArmRow extends ArmStats {
  visitors: number;
  conversions: number;
  revenue: number;
  rpv: number;
  /** Meta primária: piora uma meta de guarda. */
  guardrailViolated?: boolean;
}
export interface GoalReport {
  sections?: {
    sectionId: string;
    name: string;
    options: (Omit<ArmStats, 'variationId' | 'verdict'> & {
      optionId: string;
      name: string;
      visitors: number;
      conversions: number;
    })[];
  }[];
  goalId: string;
  goalKey: string;
  primary: boolean;
  hasRevenue: boolean;
  arms: ArmRow[];
  revenueArms: ArmStats[] | null;
  guardrail?: boolean;
  /** CUPED: redução de variância obtida (0..1). */
  cuped?: { reduction: number; revenueReduction: number | null };
}
export interface ExperimentReport {
  experimentId: string;
  from: string;
  to: string;
  visitors: number;
  variations: { id: string; key: string; name: string; visitors: number }[];
  goals: GoalReport[];
  series: { variationId: string; points: { day: string; visitors: number; rate: number }[] }[];
  srm: { pValue: number; mismatch: boolean };
  stats?: { sequential: boolean; cuped: boolean; alpha: number };
  guardrails?: {
    goalId: string;
    goalKey: string;
    variationId: string;
    metric: 'rate' | 'revenue';
    lift: number | null;
  }[];
  estimate: { neededPerVariation: number | null; daysRemaining: number | null; mde: number };
}
export const rebalance = (id: string) =>
  api<{ changed: boolean; weights: number[]; publishError?: string }>(
    `/experiments/${encodeURIComponent(id)}/rebalance`,
    {
      method: 'POST',
    },
  );
export const getReport = (id: string, p: { days?: number; device?: string }) =>
  query<ExperimentReport>(`/experiments/${encodeURIComponent(id)}/report`, p);

export interface RecordingRow {
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
  clicks: number;
  rage: number;
  dead: number;
  conversions: number;
  customEvents: number;
}
export const listRecordings = (p: Record<string, string | number | undefined>) =>
  query<RecordingRow[]>('/recordings', p);
export const getRecording = (sessionId: string) =>
  query<{
    sessionId: string;
    events: { timestamp: number; type: number }[];
    timeline: import('@abtest/shared').TrackingEvent[];
  }>(`/recordings/${encodeURIComponent(sessionId)}`);

export interface Entity<T> {
  id: string;
  kind: string;
  name: string;
  data: T;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
/** CRUD genérico das entidades de configuração (funis, audiências, campanhas…). */
export const entities = {
  list: <T>(kind: string) => api<Entity<T>[]>(`/entities/${kind}`),
  get: <T>(kind: string, id: string) => api<Entity<T>>(`/entities/${kind}/${encodeURIComponent(id)}`),
  save: (kind: string, e: { id?: string; name: string; data: unknown }) =>
    e.id
      ? api<{ id: string }>(`/entities/${kind}/${encodeURIComponent(e.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ name: e.name, data: e.data }),
        })
      : api<{ id: string }>(`/entities/${kind}`, {
          method: 'POST',
          body: JSON.stringify({ name: e.name, data: e.data }),
        }),
  remove: (kind: string, id: string) =>
    api<void>(`/entities/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const rebuildRecos = () =>
  api<{ products: number; builtAt: string }>('/recommendations/rebuild', { method: 'POST' });

/** Baixa um arquivo autenticado (CSV de exportação). */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, `erro ${res.status}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: 'viewer' | 'editor';
  createdAt: string;
}
export const apiKeys = {
  list: () => api<ApiKey[]>('/account/api-keys'),
  create: (name: string, role: ApiKey['role']) =>
    api<{ id: string; key: string }>('/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, role }),
    }),
  revoke: (id: string) => api<void>(`/account/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
export const testWebhook = (id: string) =>
  api<{ status: number }>(`/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST' });

export interface Predictive {
  config: Entity<import('@abtest/shared').PropensityConfig> | null;
  model: {
    goal: string;
    trainedAt: string;
    horizonDays: number;
    samples: number;
    positives: number;
    baseRate: number;
    auc: number;
    deciles: { rate: number; n: number; minScore: number }[];
    importance: { feature: string; weight: number }[];
  } | null;
}
export const getPredictive = () => api<Predictive>('/predictive');
export const trainPredictive = () => api<unknown>('/predictive/train', { method: 'POST' });

export interface Idea {
  title: string;
  hypothesis: string;
  page: string;
  change: string;
  metric: string;
  impact: string;
  effort: string;
  basedOn: string;
}
export interface SavedIdea extends Idea {
  id: string;
  createdAt: string;
  source: 'claude' | 'modelo' | 'regras';
  model?: string;
  /** Marcada como executada pelo usuário. */
  doneAt?: string;
}
/** Ideias guardadas na conta + estado da última geração (que roda em segundo plano na API). */
export interface Ideas {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: string;
  finishedAt?: string;
  source?: 'claude' | 'modelo' | 'regras';
  model?: string;
  error?: string;
  /** Por que a última geração usou as regras em vez da IA. */
  notice?: string;
  ideas: SavedIdea[];
}
export const ideas = {
  get: () => api<Ideas>('/ai/ideas'),
  generate: (days: number) => api<Ideas>(`/ai/ideas?days=${days}`, { method: 'POST' }),
  done: (id: string, done: boolean) =>
    api<Ideas>(`/ai/ideas/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ done }) }),
  remove: (id: string) => api<Ideas>(`/ai/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clear: () => api<Ideas>('/ai/ideas', { method: 'DELETE' }),
};
