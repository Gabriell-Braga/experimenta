import type { TrackingEvent, Webhook } from '@abtest/shared';
import { hmacHex } from './crypto';
import type { Repo } from './repo';

const TTL = 60_000;
const cache = new Map<string, { at: number; hooks: { id: string; data: Webhook }[] }>();

/** Webhooks ativos da conta (cache de 1 min: o /collect não consulta o banco a cada lote). */
async function hooksOf(repo: Repo, accountId: string) {
  const c = cache.get(accountId);
  if (c && Date.now() - c.at < TTL) return c.hooks;
  const hooks = (await repo.listEntities<Webhook>(accountId, 'webhook')).filter((h) => h.data.enabled);
  cache.set(accountId, { at: Date.now(), hooks });
  return hooks;
}
export const forgetWebhooks = (accountId: string) => cache.delete(accountId);

/** Assina e envia. Erro do destino não derruba nada (entrega "pelo menos tentada"). */
export async function deliver(
  url: string,
  secret: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
) {
  const body = JSON.stringify(payload);
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Experimenta-Webhooks/1',
        'x-abt-signature': `sha256=${await hmacHex(secret, body)}`,
      },
    });
    return r.status;
  } catch {
    return 0;
  }
}

/**
 * Despacha para cada webhook os eventos dos tipos que ele assinou, num POST por lote:
 * `{ account, type: 'events', events: [...] }`. Eventos de QA não saem.
 */
export async function dispatchEvents(
  repo: Repo,
  accountId: string,
  events: TrackingEvent[],
  fetchImpl?: typeof fetch,
) {
  const hooks = await hooksOf(repo, accountId);
  await Promise.all(
    hooks.map((h) => {
      const mine = events.filter((e) => !e.qa && (h.data.events as string[]).includes(e.type));
      return mine.length
        ? deliver(h.data.url, h.data.secret, { account: accountId, type: 'events', events: mine }, fetchImpl)
        : null;
    }),
  );
}

/** Aviso da conta para quem assinou o tipo: `{ account, type, ...data }`. */
export async function dispatchNotice(
  repo: Repo,
  accountId: string,
  type: 'publish' | 'approval',
  data: Record<string, unknown>,
  fetchImpl?: typeof fetch,
) {
  const hooks = (await hooksOf(repo, accountId)).filter((h) => h.data.events.includes(type));
  await Promise.all(
    hooks.map((h) => deliver(h.data.url, h.data.secret, { account: accountId, type, ...data }, fetchImpl)),
  );
}

/** Aviso de publicação (`publish`): versão nova no ar. */
export const dispatchPublish = (repo: Repo, accountId: string, version: number, fetchImpl?: typeof fetch) =>
  dispatchNotice(repo, accountId, 'publish', { version }, fetchImpl);
