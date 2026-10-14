import { ExperimentSchema, type Experiment } from '@abtest/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
export const ACCOUNT_ID: string = import.meta.env.VITE_ACCOUNT_ID ?? 'demo';
export const DEFAULT_SITE_URL: string = import.meta.env.VITE_SITE_URL ?? 'http://localhost:5180/';

export async function createEditSession(): Promise<string> {
  const res = await fetch(`${API_URL}/edit-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: ACCOUNT_ID }),
  });
  if (!res.ok) throw new Error(`não foi possível abrir a sessão de edição (${res.status})`);
  return ((await res.json()) as { token: string }).token;
}

// ponytail: rascunho no localStorage até a persistência na API (fase 4).
const DRAFT_KEY = 'abt-editor-draft';

export function loadDraft(): { experiment: Experiment; url: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as {
      experiment: unknown;
      url: string;
    } | null;
    if (!raw) return null;
    return { experiment: ExperimentSchema.parse(raw.experiment), url: raw.url };
  } catch {
    return null;
  }
}

export function saveDraft(experiment: Experiment, url: string): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ experiment, url }));
}

/** URL do site com o token de edição (o snippet entra em modo edição só dentro do iframe). */
export function frameUrl(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set('abt_edit', token);
  return u.href;
}
