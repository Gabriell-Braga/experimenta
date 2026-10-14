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
  return api<import('@abtest/shared').HeatmapData & { page: string }>(`/heatmap?${q}`);
}
