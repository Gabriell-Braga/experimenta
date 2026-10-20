import type { TrackingEvent, Webhook } from '@abtest/shared';
import { hmacHex, newId } from './crypto';
import type { DeliveryUpdate, Repo, WebhookDelivery } from './repo';

// Webhooks (14.4, D-063) com fila de reenvio (19.4, D-092). A entrega continua imediata (waitUntil); só o que
// falha vai para a tabela `webhook_deliveries` (entrega certa de primeira não grava nada: custo de linhas do D1).
// Reenvio com recuo exponencial e jitter até MAX_ATTEMPTS; depois fica "falhou" na tela com "Reenviar".
// Quem drena a fila: o job de hora em hora (todas as contas) e o próprio tráfego da conta (cada despacho drena
// as vencidas, no máximo uma vez por minuto por isolate), que é o que faz os reenvios de minutos acontecerem
// sem cron extra.

const TTL = 60_000;
const cache = new Map<string, { at: number; hooks: { id: string; data: Webhook }[] }>();

/** Tentativas no total (a imediata + 5 reenvios em ~26 h). */
export const MAX_ATTEMPTS = 6;
/** Espera depois da tentativa n (1..5): 1 min × 6^(n-1) = 1 min, 6 min, 36 min, 3,6 h, 21,6 h (±20%). */
export function backoffMs(attempt: number, rand = Math.random()) {
  return Math.round(60_000 * 6 ** (attempt - 1) * (0.8 + 0.4 * rand));
}
/** Teto de pendentes por webhook: destino fora do ar com muito tráfego não enche o banco. */
export const MAX_PENDING = 1000;
const TIMEOUT_MS = 10_000;
/** Vez de quem está entregando (se a invocação morrer no meio, outra tenta depois disto). */
const LEASE_MS = 2 * 60_000;
/** Entregas encerradas ficam visíveis por 7 dias. */
export const KEEP_MS = 7 * 86_400_000;

/** Webhooks ativos da conta (cache de 1 min: o /collect não consulta o banco a cada lote). */
async function hooksOf(repo: Repo, accountId: string) {
  const c = cache.get(accountId);
  if (c && Date.now() - c.at < TTL) return c.hooks;
  const hooks = (await repo.listEntities<Webhook>(accountId, 'webhook')).filter((h) => h.data.enabled);
  cache.set(accountId, { at: Date.now(), hooks });
  return hooks;
}
export const forgetWebhooks = (accountId: string) => cache.delete(accountId);

/** Vale reenviar? Sem resposta, timeout, 5xx, 408 e 429 sim; outro 4xx (e 3xx) não: o destino recusou. */
export const retryable = (status: number) =>
  status === 0 || status >= 500 || status === 408 || status === 429;
const ok = (status: number) => status >= 200 && status < 300;

/**
 * Assina e envia um corpo pronto. `X-Abt-Delivery` (id) e a assinatura são os mesmos em todas as tentativas;
 * `X-Abt-Attempt` conta a tentativa. Erro do destino não derruba nada: devolve o status (0 = sem resposta).
 */
export async function post(
  url: string,
  secret: string,
  body: string,
  meta: { id: string; attempt: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; error: string | null }> {
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Experimenta-Webhooks/1',
        'x-abt-signature': `sha256=${await hmacHex(secret, body)}`,
        'x-abt-delivery': meta.id,
        'x-abt-attempt': String(meta.attempt),
      },
    });
    await r.body?.cancel().catch(() => undefined);
    return { status: r.status, error: ok(r.status) ? null : `HTTP ${r.status}` };
  } catch (e) {
    const name = (e as Error).name;
    return {
      status: 0,
      error: name === 'TimeoutError' ? 'sem resposta em 10 s' : 'sem conexão com o destino',
    };
  }
}

/** Envio avulso (botão de teste): uma tentativa, sem fila. Devolve o status HTTP. */
export async function deliver(url: string, secret: string, payload: unknown, fetchImpl?: typeof fetch) {
  const r = await post(url, secret, JSON.stringify(payload), { id: newId('dlv'), attempt: 1 }, fetchImpl);
  return r.status;
}

/** Estado depois de uma tentativa que deu `status`. */
function outcome(attempts: number, r: { status: number; error: string | null }, now: number): DeliveryUpdate {
  if (ok(r.status))
    return { status: 'delivered', attempts, nextAt: null, lastStatus: r.status, lastError: null };
  if (retryable(r.status) && attempts < MAX_ATTEMPTS)
    return {
      status: 'pending',
      attempts,
      nextAt: new Date(now + backoffMs(attempts)).toISOString(),
      lastStatus: r.status,
      lastError: r.error,
    };
  return { status: 'failed', attempts, nextAt: null, lastStatus: r.status, lastError: r.error };
}

/** Primeira tentativa de um envio; se falhar, entra na fila (ou fica como falha, se o destino recusou). */
async function send(
  repo: Repo,
  accountId: string,
  hook: { id: string; data: Webhook },
  type: string,
  payload: unknown,
  fetchImpl?: typeof fetch,
) {
  const id = newId('dlv');
  const body = JSON.stringify(payload);
  const r = await post(hook.data.url, hook.data.secret, body, { id, attempt: 1 }, fetchImpl);
  if (ok(r.status)) return;
  const u = outcome(1, r, Date.now());
  if (
    u.status === 'pending' &&
    (await repo.countWebhookDeliveries(accountId, hook.id)).pending >= MAX_PENDING
  ) {
    // ponytail: fila cheia descarta a entrega nova; um "circuito aberto" que segura o envio resolve se for comum.
    console.warn(`[webhooks] fila cheia: ${accountId}/${hook.id}`);
    return;
  }
  await repo.addWebhookDelivery(accountId, { id, webhookId: hook.id, type, body, ...u });
}

/** Tenta de novo uma entrega (pela fila ou pelo botão). Devolve o novo estado. */
export async function retryDelivery(
  repo: Repo,
  accountId: string,
  d: WebhookDelivery,
  hook: { data: Webhook } | null,
  opts: { now?: number; fetchImpl?: typeof fetch; manual?: boolean } = {},
): Promise<DeliveryUpdate> {
  const now = opts.now ?? Date.now();
  const attempts = d.attempts + 1;
  const u: DeliveryUpdate =
    !hook || !hook.data.enabled
      ? {
          status: 'failed',
          attempts: d.attempts,
          nextAt: null,
          lastStatus: d.lastStatus,
          lastError: hook ? 'webhook desligado' : 'webhook removido',
        }
      : outcome(
          attempts,
          await post(
            hook.data.url,
            hook.data.secret,
            d.body,
            { id: d.id, attempt: attempts },
            opts.fetchImpl,
          ),
          now,
        );
  // Reenvio manual que falha de novo não volta para a fila automática: fica como falha até o próximo clique.
  if (opts.manual && u.status === 'pending') Object.assign(u, { status: 'failed', nextAt: null });
  await repo.updateWebhookDelivery(accountId, d.id, u);
  return u;
}

/**
 * Drena as entregas vencidas: de uma conta (tráfego) ou de todas (job). Pega a vez de cada uma antes de enviar
 * (troca condicional do `next_at`), então duas drenagens simultâneas não entregam a mesma. Para no limite de
 * entregas ou de tempo. Devolve quantas tentou.
 */
export async function drainWebhooks(
  repo: Repo,
  opts: { accountId?: string; limit: number; budgetMs: number; now?: number; fetchImpl?: typeof fetch },
) {
  const start = Date.now();
  const now = opts.now ?? start;
  const due = await repo.dueWebhookDeliveries(new Date(now), opts.limit, opts.accountId);
  const hooks = new Map<string, Map<string, { data: Webhook }>>();
  let tried = 0;
  for (const d of due) {
    if (Date.now() - start > opts.budgetMs) break;
    const lease = new Date(now + LEASE_MS).toISOString();
    const claimed = await repo.updateWebhookDelivery(
      d.accountId,
      d.id,
      {
        status: 'pending',
        attempts: d.attempts,
        nextAt: lease,
        lastStatus: d.lastStatus,
        lastError: d.lastError,
      },
      d.nextAt!,
    );
    if (!claimed) continue;
    let mine = hooks.get(d.accountId);
    if (!mine) {
      // Todos os webhooks da conta (também os desligados: desligado ≠ removido na mensagem).
      const list = await repo.listEntities<Webhook>(d.accountId, 'webhook');
      hooks.set(d.accountId, (mine = new Map(list.map((h) => [h.id, h]))));
    }
    await retryDelivery(repo, d.accountId, d, mine.get(d.webhookId) ?? null, {
      now,
      fetchImpl: opts.fetchImpl,
    });
    tried++;
  }
  return tried;
}

const lastDrain = new Map<string, number>();
/** Drenagem pelo tráfego da conta: no máximo uma por minuto por isolate, poucas entregas e 15 s. */
async function drainOnTraffic(repo: Repo, accountId: string, fetchImpl?: typeof fetch) {
  const now = Date.now();
  if (now - (lastDrain.get(accountId) ?? 0) < 60_000) return;
  lastDrain.set(accountId, now);
  await drainWebhooks(repo, { accountId, limit: 10, budgetMs: 15_000, fetchImpl });
}

/** Job de hora em hora: drena todas as contas (lotes pequenos, tempo limitado) e limpa as encerradas antigas. */
export async function webhookJobs(repo: Repo, fetchImpl?: typeof fetch) {
  await drainWebhooks(repo, { limit: 100, budgetMs: 60_000, fetchImpl });
  await repo.purgeWebhookDeliveries(new Date(Date.now() - KEEP_MS));
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
  if (!hooks.length) return;
  await Promise.all(
    hooks.map((h) => {
      const mine = events.filter((e) => !e.qa && (h.data.events as string[]).includes(e.type));
      return mine.length
        ? send(repo, accountId, h, 'events', { account: accountId, type: 'events', events: mine }, fetchImpl)
        : null;
    }),
  );
  await drainOnTraffic(repo, accountId, fetchImpl);
}

/** Aviso da conta para quem assinou o tipo: `{ account, type, ...data }`. */
export async function dispatchNotice(
  repo: Repo,
  accountId: string,
  type: 'publish' | 'approval' | 'mention',
  data: Record<string, unknown>,
  fetchImpl?: typeof fetch,
) {
  const all = await hooksOf(repo, accountId);
  const hooks = all.filter((h) => h.data.events.includes(type));
  await Promise.all(
    hooks.map((h) => send(repo, accountId, h, type, { account: accountId, type, ...data }, fetchImpl)),
  );
  if (all.length) await drainOnTraffic(repo, accountId, fetchImpl);
}

/** Aviso de publicação (`publish`): versão nova no ar. */
export const dispatchPublish = (repo: Repo, accountId: string, version: number, fetchImpl?: typeof fetch) =>
  dispatchNotice(repo, accountId, 'publish', { version }, fetchImpl);
