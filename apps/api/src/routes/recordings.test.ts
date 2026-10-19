import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const T0 = Date.now() - 60_000;

const chunk = (
  sessionId: string,
  events: { timestamp: number; type: number; data?: unknown }[],
  device = 'desktop',
) => ({
  accountId: DEMO.accountId,
  sessionId,
  visitorId: `v-${sessionId}`,
  device,
  vw: 1280,
  vh: 720,
  events,
});
const post = (body: unknown) =>
  t.app.request('/rec', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'text/plain' },
  });

beforeAll(async () => {
  t = await setupApp();
  // Sessão A em dois blocos (duas páginas) + frustração; sessão B curta no celular.
  expect(
    (
      await post(
        chunk('sA', [
          { timestamp: T0, type: 4, data: { href: 'http://localhost:5180/', width: 1280, height: 720 } },
          { timestamp: T0 + 1, type: 2, data: { node: {} } },
          { timestamp: T0 + 5000, type: 3, data: { source: 2 } },
        ]),
      )
    ).status,
  ).toBe(204);
  await post(
    chunk('sA', [
      { timestamp: T0 + 20_000, type: 4, data: { href: 'http://localhost:5180/produto.html' } },
      { timestamp: T0 + 30_000, type: 3, data: { source: 1 } },
    ]),
  );
  await post(
    chunk('sB', [{ timestamp: T0 + 2000, type: 4, data: { href: 'http://localhost:5180/loja/' } }], 'mobile'),
  );
  await t.collect([
    ev({
      type: 'frustration',
      sessionId: 'sA',
      device: 'desktop',
      variations: {},
      kind: 'rage',
      selector: 'h1',
      rx: 0,
      ry: 0,
      count: 3,
    } as never),
    ev({
      type: 'click',
      sessionId: 'sA',
      device: 'desktop',
      variations: {},
      selector: 'h1',
      rx: 0,
      ry: 0,
      px: 0,
      py: 0,
      vw: 1,
      vh: 1,
    } as never),
    ev({ type: 'pageview', sessionId: 'sA', device: 'desktop' } as never),
  ]);
});

type Rec = {
  sessionId: string;
  durationMs: number;
  pages: string[];
  device: string;
  events: number;
  rage: number;
  clicks: number;
};

test('blocos se juntam numa sessão: duração, páginas em ordem, contagens', async () => {
  const list = await t.get<Rec[]>('/recordings?days=1');
  const a = list.find((r) => r.sessionId === 'sA')!;
  expect(a).toMatchObject({
    durationMs: 30_000,
    pages: ['http://localhost:5180/', 'http://localhost:5180/produto.html'],
    events: 5,
    rage: 1,
    clicks: 1,
  });
  expect(list.map((r) => r.sessionId)).toEqual(['sB', 'sA']); // mais recente primeiro
});

test('filtros: dispositivo, página, duração mínima e só com frustração', async () => {
  expect((await t.get<Rec[]>('/recordings?device=mobile')).map((r) => r.sessionId)).toEqual(['sB']);
  expect((await t.get<Rec[]>('/recordings?page=produto')).map((r) => r.sessionId)).toEqual(['sA']);
  expect((await t.get<Rec[]>('/recordings?minSeconds=10')).map((r) => r.sessionId)).toEqual(['sA']);
  expect((await t.get<Rec[]>('/recordings?frustrated=1')).map((r) => r.sessionId)).toEqual(['sA']);
});

test('reprodução: eventos rrweb ordenados + linha do tempo; isolamento e validação', async () => {
  const r = await t.get<{ events: { timestamp: number }[]; timeline: { type: string }[] }>('/recordings/sA');
  expect(r.events.map((e) => e.timestamp)).toEqual([T0, T0 + 1, T0 + 5000, T0 + 20_000, T0 + 30_000]);
  expect(r.timeline.map((e) => e.type).sort()).toEqual(['click', 'frustration', 'pageview']);
  expect((await t.req('/recordings/sA', { as: 'other' })).status).toBe(404);
  expect((await t.req('/recordings', { as: 'other' })).status).toBe(200);
  expect((await post({ ...chunk('x', []) })).status).toBe(400);
  expect((await post({ ...chunk('x', [{ timestamp: 1, type: 4 }]), accountId: 'nao-existe' })).status).toBe(
    204,
  );
  expect(await t.repo.getRecordingEvents('nao-existe', 'x')).toBeNull();
});

test('retenção apaga gravações antigas', async () => {
  await t.repo.purgeEventsBefore(new Date(Date.now() + 1000));
  expect(await t.get<Rec[]>('/recordings')).toEqual([]);
});
