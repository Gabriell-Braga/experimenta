import { ExperimentSchema, type Experiment } from '@abtest/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'abt-token';

export interface Me {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  canPublishJs: boolean;
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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && path !== '/auth/login') logout();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `erro ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function login(email: string, password: string): Promise<Me> {
  const r = await api<{ token: string; user: Me }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, r.token);
  return r.user;
}

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
}
export const getAccountSettings = () => api<AccountSettings>('/account/settings');
export const saveAccountSettings = (s: AccountSettings) =>
  api<AccountSettings>('/account/settings', { method: 'PUT', body: JSON.stringify(s) });

export const publish = () => api<{ version: number }>('/publish', { method: 'POST' });

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
}
export interface ArmRow extends ArmStats {
  visitors: number;
  conversions: number;
  revenue: number;
  rpv: number;
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
