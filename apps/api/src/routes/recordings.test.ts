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

test('origem da sessão (UTMs da 1ª página), país/estado da borda, eventos e filtro por segmento do CDP', async () => {
  const pv = (url: string, ts: number) =>
    ev({
      type: 'pageview',
      sessionId: 'sB',
      visitorId: 'v-sB',
      device: 'mobile',
      url,
      ts,
      country: 'XX',
    } as never);
  // País do IP vem do cabeçalho da borda; o valor enviado pelo navegador é descartado.
  const r = await t.app.request('/collect', {
    method: 'POST',
    body: JSON.stringify({
      events: [
        pv('http://localhost:5180/loja/?utm_source=google&utm_medium=cpc&utm_campaign=tenis', T0 + 2000),
        pv('http://localhost:5180/loja/produto', T0 + 3000),
        ev({ type: 'event', sessionId: 'sB', visitorId: 'v-sB', name: 'add_to_cart', props: {} } as never),
      ],
    }),
    headers: { 'cf-ipcountry': 'BR' },
  });
  expect(r.status).toBe(204);
  type Row = Rec & { utm: object; country?: string; eventNames: string[] };
  const b = (await t.get<Row[]>('/recordings?days=1')).find((x) => x.sessionId === 'sB')!;
  expect(b).toMatchObject({
    utm: { source: 'google', medium: 'cpc', campaign: 'tenis' },
    country: 'BR',
    eventNames: ['add_to_cart'],
  });

  const seg = await t.req('/entities/segment', {
    as: 'editor',
    method: 'POST',
    body: JSON.stringify({
      name: 'Carrinho',
      data: { rules: [{ field: 'event', name: 'add_to_cart', op: 'gte', value: 1 }] },
    }),
  });
  const { id } = (await seg.json()) as { id: string };
  expect((await t.get<Row[]>(`/recordings?days=1&segment=${id}`)).map((x) => x.sessionId)).toEqual(['sB']);
  expect((await t.req('/recordings?segment=nao-existe', { as: 'viewer' })).status).toBe(404);
});

test('retenção apaga gravações antigas', async () => {
  await t.repo.purgeEventsBefore(new Date(Date.now() + 1000));
  expect(await t.get<Rec[]>('/recordings')).toEqual([]);
});
