import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { CRM_BATCH, syncAllCrm } from './crm';
import { DEMO } from './seed';
import { ev, setupApp } from './test-app';

// Servidor HTTP falso no lugar das APIs do HubSpot e do Salesforce (sem conta real).
type Req = { method: string; url: string; auth: string; body: string };
let reqs: Req[] = [];
let reply: (r: Req) => [number, unknown] = () => [200, {}];
let server: Server;
let base = '';
let t: Awaited<ReturnType<typeof setupApp>>;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const r = { method: req.method!, url: req.url!, auth: req.headers.authorization ?? '', body };
      reqs.push(r);
      const [status, out] = reply(r);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t = await setupApp({ crmBase: { hubspot: base, salesforce: base } });
  await t.collect([
    ev({ type: 'identify', visitorId: 'va', userId: 'Ana@Loja.com', attrs: { plano: 'pro' } }),
    ev({ type: 'pageview', visitorId: 'va', device: 'desktop' } as never),
    ev({ type: 'identify', visitorId: 'vb', userId: 'u2', attrs: { email: 'bia@loja.com' } }),
    ev({ type: 'event', visitorId: 'vb', name: 'compra', value: 99.9 } as never),
    ev({ type: 'pageview', visitorId: 'anon', device: 'mobile' } as never), // sem e-mail: não vai
  ]);
  await t.req('/entities/segment', {
    method: 'POST',
    as: 'editor',
    body: JSON.stringify({
      name: 'Compradores',
      data: { match: 'all', rules: [{ field: 'event', name: 'compra', op: 'gte', value: 1 }] },
    }),
  });
});
afterAll(() => new Promise((ok) => server.close(ok)));
beforeEach(() => {
  reqs = [];
  reply = () => [200, {}];
});

const put = (body: unknown, as = 'owner') =>
  t.req('/integrations/crm', { method: 'PUT', body: JSON.stringify(body), as });
const sync = (p: string, as = 'editor') => t.req(`/integrations/crm/${p}/sync`, { method: 'POST', as });

test('HubSpot: token só escrita; upsert por e-mail com os campos mapeados; cursor manda só o que mudou', async () => {
  expect((await put({ hubspot: { enabled: true, token: 'pat-1' } }, 'editor')).status).toBe(403);
  // Ligar sem campos: recusado.
  expect((await put({ hubspot: { enabled: true, token: 'pat-1' } })).status).toBe(400);
  const fields = [
    { from: 'segments', to: 'abt_segments' },
    { from: 'revenue', to: 'abt_revenue' },
    { from: 'attr.plano', to: 'plano' },
  ];
  const r = await put({ hubspot: { enabled: true, token: 'pat-secreto', fields } });
  expect(r.status).toBe(200);
  const view = await t.get<{ hasHubspotToken: boolean }>('/integrations/crm', 'viewer');
  expect(view.hasHubspotToken).toBe(true);
  expect(JSON.stringify(view)).not.toContain('pat-secreto');
  // Salvar sem token mantém o anterior.
  expect((await put({ hubspot: { enabled: true, fields } })).status).toBe(200);

  reply = (q) => [200, { status: 'COMPLETE', results: JSON.parse(q.body).inputs }];
  expect((await sync('hubspot', 'viewer')).status).toBe(403);
  const s = (await (await sync('hubspot')).json()) as { sent: number; remaining: number; ok: boolean };
  expect(s).toMatchObject({ ok: true, sent: 2, remaining: 0, failed: 0 });
  expect(reqs).toHaveLength(1);
  expect(reqs[0]!.url).toBe('/crm/v3/objects/contacts/batch/upsert');
  expect(reqs[0]!.auth).toBe('Bearer pat-secreto');
  const inputs = JSON.parse(reqs[0]!.body).inputs as { id: string; properties: Record<string, string> }[];
  expect(inputs.map((i) => i.id).sort()).toEqual(['ana@loja.com', 'bia@loja.com']);
  const bia = inputs.find((i) => i.id === 'bia@loja.com')!;
  expect(bia).toMatchObject({ idProperty: 'email' });
  expect(bia.properties).toEqual({ email: 'bia@loja.com', abt_segments: 'Compradores', abt_revenue: '99.9' });
  expect(inputs.find((i) => i.id === 'ana@loja.com')!.properties.plano).toBe('pro');

  // Nada mudou: nenhum envio. Nova atividade da Ana: só ela.
  expect(await (await sync('hubspot')).json()).toMatchObject({ sent: 0, remaining: 0 });
  expect(reqs).toHaveLength(1);
  await new Promise((ok) => setTimeout(ok, 5));
  await t.collect([ev({ type: 'pageview', visitorId: 'va', device: 'desktop' } as never)]);
  await sync('hubspot');
  expect(JSON.parse(reqs[1]!.body).inputs.map((i: { id: string }) => i.id)).toEqual(['ana@loja.com']);

  // Auditoria: configuração e sincronização entram no histórico, sem o token.
  const { items } = await t.get<{ items: { action: string; targetName: string; detail: string }[] }>(
    '/activities?type=integrations',
  );
  expect(items.map((i) => i.action)).toEqual(['sync', 'sync', 'sync', 'update']); // edições seguidas se juntam
  expect(items[3]!.detail).toBe('HubSpot ligado · Salesforce desligado');
  expect(items[0]!).toMatchObject({ targetName: 'HubSpot', detail: '1 perfis enviados' });
  expect(JSON.stringify(items)).not.toContain('pat-secreto');
});

test('HubSpot: erro parcial (207) e credencial recusada (401) aparecem na situação; 401 não avança o cursor', async () => {
  await put({
    hubspot: { enabled: true, token: 'pat-x', fields: [{ from: 'sessions', to: 'abt_sessions' }] },
  });
  reply = () => [401, { message: 'Authentication credentials not found' }];
  const fail = (await (await sync('hubspot')).json()) as { ok: boolean; errors: string[]; remaining: number };
  expect(fail.ok).toBe(false);
  expect(fail.errors[0]).toContain('HubSpot respondeu 401');
  expect(fail.remaining).toBe(2);
  reply = (q) => [
    207,
    {
      results: JSON.parse(q.body).inputs.slice(1),
      errors: [{ status: 'error', message: 'Property "abt_sessions" does not exist' }],
      numErrors: 1,
    },
  ];
  const partial = await (await sync('hubspot')).json();
  expect(partial).toMatchObject({ ok: false, sent: 1, failed: 1, remaining: 0 });
  expect(partial.errors).toEqual(['Property "abt_sessions" does not exist']);
  const view = await t.get<{ status: { hubspot: { total: number } } }>('/integrations/crm');
  expect(view.status.hubspot.total).toBe(1);
});

test('Salesforce: client credentials + upsert composite pelo campo de ID externo; segredo nunca volta', async () => {
  const cfg = {
    enabled: true,
    instanceUrl: 'https://acme.my.salesforce.com',
    clientId: 'cid',
    clientSecret: 'sf-segredo',
    object: 'Contact',
    externalIdField: 'Email_Externo__c',
    fields: [
      { from: 'conversions', to: 'Abt_Conversions__c' },
      { from: 'attr.plano', to: 'Plano__c' },
    ],
  };
  expect((await put({ salesforce: { ...cfg, instanceUrl: 'http://169.254.169.254' } })).status).toBe(400);
  expect((await put({ salesforce: cfg })).status).toBe(200);
  expect(JSON.stringify(await t.get('/integrations/crm'))).not.toContain('sf-segredo');
  reply = (q) =>
    q.url === '/services/oauth2/token'
      ? [200, { access_token: 'tok-1', instance_url: 'https://acme.my.salesforce.com' }]
      : [200, JSON.parse(q.body).records.map(() => ({ id: '003', success: true, errors: [] }))];
  const s = await (await sync('salesforce')).json();
  expect(s).toMatchObject({ ok: true, sent: 2 });
  expect(reqs[0]!.body).toContain('grant_type=client_credentials');
  expect(reqs[0]!.body).toContain('client_secret=sf-segredo');
  expect(reqs[1]!.method).toBe('PATCH');
  expect(reqs[1]!.url).toBe('/services/data/v61.0/composite/sobjects/Contact/Email_Externo__c');
  expect(reqs[1]!.auth).toBe('Bearer tok-1');
  const body = JSON.parse(reqs[1]!.body) as { allOrNone: boolean; records: Record<string, unknown>[] };
  expect(body.allOrNone).toBe(false);
  expect(body.records).toContainEqual({
    attributes: { type: 'Contact' },
    Email_Externo__c: 'ana@loja.com',
    Abt_Conversions__c: 0,
    Plano__c: 'pro',
  });

  // Credencial recusada no token.
  reply = () => [400, { error: 'invalid_client' }];
  await put({ salesforce: { ...cfg, clientSecret: undefined } }); // salvar recomeça o cursor
  const bad = await (await sync('salesforce')).json();
  expect(bad.ok).toBe(false);
  expect(bad.errors[0]).toContain('Salesforce recusou as credenciais (400)');
});

test('job de hora em hora sincroniza só CRMs ligados; outra conta não vê a configuração', async () => {
  await put({
    hubspot: { enabled: false, token: 'pat-x', fields: [{ from: 'sessions', to: 'abt_sessions' }] },
    salesforce: { enabled: false },
  });
  await syncAllCrm(t.repo, { hubspot: base, salesforce: base });
  expect(reqs).toHaveLength(0);
  await put({ hubspot: { enabled: true, fields: [{ from: 'sessions', to: 'abt_sessions' }] } });
  reply = (q) => [200, { results: JSON.parse(q.body).inputs }];
  await syncAllCrm(t.repo, { hubspot: base, salesforce: base });
  expect(reqs).toHaveLength(1);
  expect(JSON.parse(reqs[0]!.body).inputs).toHaveLength(2);
  const other = await t.get<{ hasHubspotToken: boolean; config: { hubspot: { enabled: boolean } } }>(
    '/integrations/crm',
    'other',
  );
  expect(other.hasHubspotToken).toBe(false);
  expect(other.config.hubspot.enabled).toBe(false);
  expect(CRM_BATCH).toBeLessThanOrEqual(100);
  expect(DEMO.accountId).toBeTruthy();
});
