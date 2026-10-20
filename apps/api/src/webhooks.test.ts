import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { hmacHex } from './crypto';
import type { Repo } from './repo';
import { testRepo } from './test-repo';
import {
  backoffMs,
  dispatchNotice,
  drainWebhooks,
  forgetWebhooks,
  MAX_ATTEMPTS,
  retryable,
  webhookJobs,
} from './webhooks';

// Fila de reenvio (19.4) contra um receptor HTTP falso: status programável, cabeçalhos registrados.
type Got = { body: string; delivery: string; attempt: string; sig: string };
let got: Got[] = [];
let status = 200;
let server: Server;
let url = '';
let repo: Repo;
let acc = '';
let other = '';
const SECRET = 'whsec_teste';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got.push({
        body,
        delivery: String(req.headers['x-abt-delivery']),
        attempt: String(req.headers['x-abt-attempt']),
        sig: String(req.headers['x-abt-signature']),
      });
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  repo = await testRepo();
  acc = (await repo.createAccount('Loja')).id;
  other = (await repo.createAccount('Outra')).id;
});
afterAll(() => new Promise((ok) => server.close(ok)));
beforeEach(() => {
  got = [];
  status = 200;
});

async function hook(accountId = acc, enabled = true) {
  forgetWebhooks(accountId);
  return repo.saveEntity(accountId, {
    kind: 'webhook',
    name: 'h',
    data: { url, events: ['publish'], enabled, secret: SECRET },
  });
}
const notice = (accountId = acc) => dispatchNotice(repo, accountId, 'publish', { version: 1 });
const later = (ms: number) => ({ limit: 50, budgetMs: 30_000, now: Date.now() + ms });

test('backoff exponencial com jitter: 6 tentativas em ~1 dia; o que reenvia', () => {
  expect(backoffMs(1, 0.5)).toBe(60_000);
  expect(backoffMs(2, 0.5)).toBe(360_000);
  const min = [1, 2, 3, 4, 5].reduce((s, n) => s + backoffMs(n, 0), 0);
  const max = [1, 2, 3, 4, 5].reduce((s, n) => s + backoffMs(n, 1), 0);
  expect(min / 3_600_000).toBeGreaterThan(20);
  expect(max / 3_600_000).toBeLessThan(32);
  expect(MAX_ATTEMPTS).toBe(6);
  for (const s of [0, 408, 429, 500, 503]) expect(retryable(s)).toBe(true);
  for (const s of [301, 400, 401, 404, 410, 422]) expect(retryable(s)).toBe(false);
});

test('certo de primeira não grava nada na fila', async () => {
  const id = await hook();
  await notice();
  expect(got).toHaveLength(1);
  expect(got[0]!.attempt).toBe('1');
  expect(got[0]!.delivery).toMatch(/^dlv_/);
  expect(await repo.listWebhookDeliveries(acc, id)).toEqual([]);
  await repo.deleteEntity(acc, 'webhook', id);
});

test('5xx entra na fila; reenvio com o mesmo id, corpo e assinatura; entregue no reenvio', async () => {
  const id = await hook();
  status = 503;
  await notice();
  const [d] = await repo.listWebhookDeliveries(acc, id);
  expect(d).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 503, lastError: 'HTTP 503' });
  const wait = Date.parse(d!.nextAt!) - Date.now();
  expect(wait).toBeGreaterThan(40_000);
  expect(wait).toBeLessThan(80_000);

  // Antes da hora: nada.
  expect(await drainWebhooks(repo, { limit: 50, budgetMs: 30_000 })).toBe(0);
  status = 200;
  expect(await drainWebhooks(repo, later(2 * 60_000))).toBe(1);
  expect(got).toHaveLength(2);
  expect(got[1]!.delivery).toBe(got[0]!.delivery);
  expect(got[1]!.delivery).toBe(d!.id);
  expect(got[1]!.attempt).toBe('2');
  expect(got[1]!.body).toBe(got[0]!.body);
  expect(got[1]!.sig).toBe(got[0]!.sig);
  expect(got[1]!.sig).toBe(`sha256=${await hmacHex(SECRET, got[0]!.body)}`);
  expect(await repo.getWebhookDelivery(acc, d!.id)).toMatchObject({
    status: 'delivered',
    attempts: 2,
    nextAt: null,
    lastStatus: 200,
    lastError: null,
  });
  // Outra conta não vê.
  expect(await repo.getWebhookDelivery(other, d!.id)).toBeNull();
  await repo.deleteEntity(acc, 'webhook', id);
});

test('4xx não reenvia (fica como falha); 429 reenvia até o máximo e desiste', async () => {
  const id = await hook();
  status = 400;
  await notice();
  const [bad] = await repo.listWebhookDeliveries(acc, id);
  expect(bad).toMatchObject({ status: 'failed', attempts: 1, lastStatus: 400, nextAt: null });

  status = 429;
  await notice();
  let t = 0;
  for (let i = 2; i <= MAX_ATTEMPTS; i++) {
    t += 30 * 3_600_000; // passa de qualquer espera
    expect(await drainWebhooks(repo, later(t))).toBe(1);
  }
  expect(await drainWebhooks(repo, later(t + 100 * 3_600_000))).toBe(0);
  const [d] = (await repo.listWebhookDeliveries(acc, id)).filter((x) => x.id !== bad!.id);
  expect(d).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, lastStatus: 429 });
  expect(got.map((g) => g.attempt)).toEqual(['1', '1', '2', '3', '4', '5', '6']);
  expect(await repo.countWebhookDeliveries(acc, id)).toEqual({ pending: 0, failed: 2 });
  await repo.deleteEntity(acc, 'webhook', id);
});

test('sem conexão entra na fila; duas drenagens ao mesmo tempo entregam uma vez só', async () => {
  forgetWebhooks(acc);
  const id = await repo.saveEntity(acc, {
    kind: 'webhook',
    name: 'fora',
    data: { url: 'http://127.0.0.1:1/nada', events: ['publish'], enabled: true, secret: SECRET },
  });
  await notice();
  const [d] = await repo.listWebhookDeliveries(acc, id);
  expect(d).toMatchObject({ status: 'pending', lastStatus: 0, lastError: 'sem conexão com o destino' });
  await repo.saveEntity(acc, {
    id,
    kind: 'webhook',
    name: 'fora',
    data: { url, events: ['publish'], enabled: true, secret: SECRET },
  });
  const [a, b] = await Promise.all([
    drainWebhooks(repo, later(120_000)),
    drainWebhooks(repo, later(120_000)),
  ]);
  expect(a + b).toBe(1);
  expect(got).toHaveLength(1);
  expect((await repo.getWebhookDelivery(acc, d!.id))?.status).toBe('delivered');
  await repo.deleteEntity(acc, 'webhook', id);
});

test('webhook removido ou desligado: a pendente vira falha com o motivo; job limpa as antigas', async () => {
  const id = await hook();
  status = 500;
  await notice();
  await notice();
  const [d1, d2] = await repo.listWebhookDeliveries(acc, id);
  await repo.saveEntity(acc, {
    id,
    kind: 'webhook',
    name: 'h',
    data: { url, events: ['publish'], enabled: false, secret: SECRET },
  });
  // Só a primeira vence agora; a segunda fica para depois da remoção.
  await repo.updateWebhookDelivery(acc, d2!.id, {
    ...d2!,
    nextAt: new Date(Date.now() + 10 * 3_600_000).toISOString(),
  });
  expect(await drainWebhooks(repo, later(2 * 60_000))).toBe(1);
  expect((await repo.getWebhookDelivery(acc, d1!.id))?.lastError).toBe('webhook desligado');
  await repo.deleteEntity(acc, 'webhook', id);
  expect(await drainWebhooks(repo, later(11 * 3_600_000))).toBe(1);
  expect(await repo.getWebhookDelivery(acc, d2!.id)).toMatchObject({
    status: 'failed',
    lastError: 'webhook removido',
  });
  expect(got).toHaveLength(2); // só as duas primeiras tentativas

  // Encerradas com mais de 7 dias somem; pendentes nunca.
  await repo.purgeWebhookDeliveries(new Date(Date.now() + 60_000));
  expect(await repo.getWebhookDelivery(acc, d1!.id)).toBeNull();
  await webhookJobs(repo); // não quebra com a fila vazia
});
