import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const T0 = Date.now() - 60_000;

interface Export {
  visitorIds: string[];
  profiles: { userId?: string; attributes: Record<string, unknown> }[];
  events: { type: string; visitorId: string }[];
  surveys: unknown[];
  forms: unknown[];
  recordings: { sessionId: string; events: unknown[] }[];
}

beforeAll(async () => {
  t = await setupApp();
  const acc = DEMO.accountId;
  // Titular: usuário u-ana em dois aparelhos (va1, va2); outro visitante (vb) não pode sair junto.
  await t.repo.insertEvents(acc, [
    ev({ type: 'pageview', visitorId: 'va1', sessionId: 'sa1', device: 'desktop' }),
    ev({ type: 'identify', visitorId: 'va1', userId: 'u-ana', attrs: { plano: 'pro' } }),
    ev({ type: 'identify', visitorId: 'va2', sessionId: 'sa2', userId: 'u-ana' }),
    ev({ type: 'survey', visitorId: 'va2', surveyId: 's1', answers: [], completed: true }),
    ev({
      type: 'form',
      visitorId: 'va2',
      device: 'mobile',
      variations: {},
      form: '#f',
      fields: [],
      interacted: true,
      submitted: false,
    }),
    ev({ type: 'pageview', visitorId: 'vb', sessionId: 'sb', device: 'desktop' }),
  ]);
  for (const [sessionId, visitorId] of [
    ['sa1', 'va1'],
    ['sb', 'vb'],
  ] as const)
    await t.repo.saveRecordingChunk(acc, {
      sessionId,
      visitorId,
      device: 'desktop',
      vw: 1280,
      vh: 720,
      events: [{ timestamp: T0, type: 4, data: { href: 'http://localhost:5180/' } }],
    });
  // Mesmo id de visitante em outra conta: não pode ser lido nem apagado daqui.
  await t.repo.insertEvents(t.otherAccountId, [
    ev({ type: 'pageview', accountId: t.otherAccountId, visitorId: 'va1', device: 'desktop' } as never),
  ]);
  const delivery = (id: string, visitorId: string) =>
    t.repo.addWebhookDelivery(acc, {
      id,
      webhookId: 'wh1',
      type: 'events',
      body: JSON.stringify({ events: [{ type: 'pageview', visitorId }] }),
      status: 'pending',
      attempts: 1,
      nextAt: new Date(Date.now() + 60_000).toISOString(),
      lastStatus: 500,
      lastError: 'x',
    });
  await delivery('dlv-a', 'va1');
  await delivery('dlv-b', 'vb');
});

test('só owner; precisa de visitorId ou userId', async () => {
  expect((await t.req('/privacy/subject?visitorId=va1', { as: 'editor' })).status).toBe(403);
  expect((await t.req('/privacy/subject?visitorId=va1', { method: 'DELETE', as: 'viewer' })).status).toBe(
    403,
  );
  expect((await t.req('/privacy/subject', { as: 'owner' })).status).toBe(400);
  expect((await t.req('/privacy/subject?visitorId=a&userId=b', { as: 'owner' })).status).toBe(400);
});

test('exporta tudo do usuário do CDP (todos os aparelhos) e nada de outro visitante', async () => {
  const r = await t.get<Export>('/privacy/subject?userId=u-ana');
  expect(r.visitorIds.sort()).toEqual(['va1', 'va2']);
  expect(r.events).toHaveLength(5);
  expect(r.events.every((e) => e.visitorId !== 'vb')).toBe(true);
  expect(r.surveys).toHaveLength(1);
  expect(r.forms).toHaveLength(1);
  expect(r.profiles).toHaveLength(1);
  expect(r.profiles[0]).toMatchObject({ userId: 'u-ana', attributes: { plano: 'pro' } });
  expect(r.recordings.map((x) => [x.sessionId, x.events.length])).toEqual([['sa1', 1]]);
  const one = await t.get<Export>('/privacy/subject?visitorId=vb');
  expect(one.events).toHaveLength(1);
});

test('apaga tudo do titular só nesta conta e registra no histórico', async () => {
  const r = await t.req('/privacy/subject?userId=u-ana', { method: 'DELETE', as: 'owner' });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ events: 5, recordings: 1 });
  const after = await t.get<Export>('/privacy/subject?visitorId=va1');
  expect(after.events).toEqual([]);
  expect(after.recordings).toEqual([]);
  expect(await t.repo.getRecordingEvents(DEMO.accountId, 'sa1')).toBeNull();
  // Outro visitante e outra conta intactos.
  expect((await t.get<Export>('/privacy/subject?visitorId=vb')).recordings).toHaveLength(1);
  expect(await t.repo.listEvents(t.otherAccountId, { visitorIds: ['va1'] })).toHaveLength(1);
  // Entrega de webhook pendente que citava o visitante saiu; a do outro ficou.
  expect(await t.repo.getWebhookDelivery(DEMO.accountId, 'dlv-a')).toBeNull();
  expect(await t.repo.getWebhookDelivery(DEMO.accountId, 'dlv-b')).not.toBeNull();
  const acts = await t.get<{ items: { action: string; targetType: string; detail: string | null }[] }>(
    '/activities?type=privacy',
  );
  expect(acts.items.map((a) => a.action)).toContain('dsar_export');
  expect(acts.items.find((a) => a.action === 'dsar_delete')?.detail).toBe('5 eventos, 1 gravações');
});
