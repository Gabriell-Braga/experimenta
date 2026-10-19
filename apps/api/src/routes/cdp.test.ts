import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;

beforeAll(async () => {
  t = await setupApp();
  const now = Date.now() - 50_000;
  await t.collect([
    // Ana: celular (v1) anônima, depois loga no desktop (v2) e no celular.
    ev({ type: 'pageview', visitorId: 'v1', sessionId: 's1', device: 'mobile', ts: now } as never),
    ev({ type: 'event', visitorId: 'v1', sessionId: 's1', name: 'compra', value: 100, ts: now + 1 } as never),
    ev({
      type: 'identify',
      visitorId: 'v1',
      sessionId: 's1',
      userId: 'ana',
      attrs: { plano: 'pro' },
      ts: now + 2,
    } as never),
    ev({ type: 'pageview', visitorId: 'v2', sessionId: 's2', device: 'desktop', ts: now + 10 } as never),
    ev({
      type: 'identify',
      visitorId: 'v2',
      sessionId: 's2',
      userId: 'ana',
      attrs: { cidade: 'Recife' },
      ts: now + 11,
    } as never),
    ev({
      type: 'exposure',
      visitorId: 'v2',
      sessionId: 's2',
      experimentId: 'e',
      experimentKey: 'hero',
      variationId: 'b',
      variationKey: 'b',
      ts: now + 12,
    } as never),
    // Anônimo.
    ev({ type: 'pageview', visitorId: 'v9', sessionId: 's9', device: 'desktop', ts: now + 20 } as never),
  ]);
});

type P = {
  id: string;
  kind: string;
  visitors: string[];
  devices: string[];
  sessions: number;
  revenue: number;
  attributes: Record<string, unknown>;
  experiments: Record<string, string>;
};

test('perfis: identidade junta visitantes e dispositivos; anônimos à parte; busca e cross-device', async () => {
  const r = await t.get<{
    total: number;
    identified: number;
    crossDevice: { identified: number; multiDevice: number };
    profiles: P[];
  }>('/profiles?days=1');
  expect(r.total).toBe(2);
  expect(r.crossDevice).toMatchObject({ identified: 1, multiDevice: 1 });
  const ana = r.profiles.find((p) => p.id === 'u:ana')!;
  expect(ana).toMatchObject({
    kind: 'user',
    sessions: 2,
    revenue: 100,
    attributes: { plano: 'pro', cidade: 'Recife' },
    experiments: { hero: 'b' },
  });
  expect(ana.visitors.sort()).toEqual(['v1', 'v2']);
  expect(ana.devices.sort()).toEqual(['desktop', 'mobile']);
  expect((await t.get<{ profiles: P[] }>('/profiles?q=recife')).profiles.map((p) => p.id)).toEqual(['u:ana']);
  expect((await t.get<{ profiles: P[] }>('/profiles?kind=anon')).profiles.map((p) => p.id)).toEqual(['v:v9']);
});

test('perfil: linha do tempo de todos os visitantes ligados; isolamento', async () => {
  const r = await t.get<{ profile: P; timeline: { visitorId: string }[] }>(
    `/profiles/${encodeURIComponent('u:ana')}`,
  );
  expect(new Set(r.timeline.map((e) => e.visitorId))).toEqual(new Set(['v1', 'v2']));
  expect(r.timeline).toHaveLength(6);
  expect((await t.req(`/profiles/${encodeURIComponent('u:ana')}`, { as: 'other' })).status).toBe(404);
});

test('segmento do CDP: membros por regras do perfil, CSV e decisão cross-channel', async () => {
  const r = await t.req('/entities/segment', {
    as: 'editor',
    method: 'POST',
    body: JSON.stringify({
      name: 'Clientes multi-dispositivo',
      data: {
        rules: [
          { field: 'devices', op: 'gte', value: 2 },
          { field: 'event', name: 'compra', op: 'gte', value: 1 },
        ],
      },
    }),
  });
  const id = ((await r.json()) as { id: string }).id;
  const m = await t.get<{ count: number; profiles: { id: string }[] }>(`/profiles/segments/${id}?days=1`);
  expect(m.count).toBe(1);
  expect(m.profiles[0]!.id).toBe('u:ana');
  const csv = await (await t.req(`/profiles/segments/${id}?days=1&format=csv`, { as: 'owner' })).text();
  expect(csv.split('\n')).toHaveLength(2);
  expect(csv).toContain('"u:ana"');
  // Decisão pelo visitante do celular (já ligado a Ana) cai no perfil dela.
  const d = await t.get<{ profile: { userId: string }; segments: { id: string }[] }>('/decide?visitor=v1');
  expect(d.profile.userId).toBe('ana');
  expect(d.segments.map((s) => s.id)).toEqual([id]);
  expect((await t.req('/decide', { as: 'owner' })).status).toBe(400);
});
