// App completo para testes de rotas: repositório de teste (Postgres ou D1), conta demo e uma segunda conta.
import type { TrackingEvent } from '@abtest/shared';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppDeps } from './app';
import { fsCdnStore } from './cdn-fs';
import { DEMO, seedDev } from './seed';
import { createSessionStore } from './sessions';
import { testRepo } from './test-repo';

export const APP_ORIGIN = 'http://localhost:5173';

export async function setupApp(extra: Partial<AppDeps> = {}) {
  const repo = await testRepo();
  await seedDev(repo);
  const cdnDir = mkdtempSync(join(tmpdir(), 'abt-cdn-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
  const app = createApp({
    repo,
    cdn: fsCdnStore(cdnDir),
    editorOrigins: [APP_ORIGIN],
    jwtSecret: 'teste',
    sessions: createSessionStore(),
    ...extra,
  });
  const tokens: Record<string, string> = {};
  const req = (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', APP_ORIGIN);
    if (init.as) headers.set('authorization', `Bearer ${tokens[init.as]}`);
    if (init.body) headers.set('content-type', 'application/json');
    return app.request(path, { ...init, headers });
  };
  const loginAs = async (who: string, cred: { email: string; password: string }) => {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify(cred) });
    tokens[who] = ((await r.json()) as { token: string }).token;
  };
  await loginAs('owner', DEMO.owner);
  await loginAs('editor', DEMO.editor);
  await loginAs('viewer', DEMO.viewer);
  const other = await repo.createAccount('Outra');
  await repo.createUser(other.id, { email: 'x@outra.com', name: 'X', password: 'x12345678', role: 'owner' });
  await loginAs('other', { email: 'x@outra.com', password: 'x12345678' });

  /** GET autenticado que devolve o JSON (falha o teste se não for 200). */
  const get = async <T = unknown>(path: string, as = 'owner'): Promise<T> => {
    const r = await req(path, { as });
    if (r.status !== 200) throw new Error(`${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  /** Envia eventos como o snippet (POST /collect). */
  const collect = (events: TrackingEvent[]) =>
    app.request('/collect', { method: 'POST', body: JSON.stringify({ events }) });
  return { app, repo, req, get, collect, tokens, otherAccountId: other.id };
}

let seq = 0;
/** Evento de teste com os campos comuns preenchidos. */
export function ev<T extends Partial<TrackingEvent> & { type: TrackingEvent['type'] }>(e: T): TrackingEvent {
  return {
    eventId: `ev${++seq}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    accountId: DEMO.accountId,
    visitorId: 'v1',
    sessionId: 's1',
    url: 'http://localhost:5180/',
    ...e,
  } as unknown as TrackingEvent;
}
