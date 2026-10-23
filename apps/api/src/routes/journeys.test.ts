import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const S = 'http://localhost:5180';

beforeAll(async () => {
  t = await setupApp();
  const pv = (s: string, path: string, at: number) =>
    ev({
      type: 'pageview',
      sessionId: s,
      visitorId: s,
      url: S + path,
      ts: Date.now() - 100_000 + at,
      device: 'desktop',
    } as never);
  await t.collect([
    pv('a', '/', 0),
    pv('a', '/', 1), // recarga não conta
    pv('a', '/produto.html', 2),
    pv('a', '/obrigado.html', 3),
    pv('b', '/', 0),
    pv('b', '/produto.html', 1),
    pv('c', '/loja/', 0),
    pv('c', '/produto.html', 1),
    pv('d', '/', 0),
  ]);
});

type J = {
  sessions: number;
  bounceRate: number;
  entries: { key: string; count: number }[];
  exits: { key: string; count: number }[];
  paths: { steps: string[]; count: number }[];
  focus: {
    views: number;
    previous: { key: string; count: number }[];
    next: { key: string; count: number }[];
  } | null;
};

test('entradas, saídas, caminhos e explorador de página', async () => {
  const j = await t.get<J>(`/analytics/journeys?days=1&page=${encodeURIComponent(`${S}/produto.html`)}`);
  expect(j.sessions).toBe(4);
  expect(j.bounceRate).toBeCloseTo(0.25, 6);
  expect(j.entries[0]).toEqual({ key: S, count: 3 });
  expect(j.exits.find((x) => x.key === `${S}/produto`)!.count).toBe(2);
  expect(j.paths[0]).toEqual({ steps: [S, `${S}/produto`, `${S}/obrigado`], count: 1 });
  expect(j.focus!.views).toBe(3);
  expect(j.focus!.previous).toEqual([
    { key: S, count: 2 },
    { key: `${S}/loja`, count: 1 },
  ]);
  expect(j.focus!.next).toEqual([
    { key: '(saída)', count: 2 },
    { key: `${S}/obrigado`, count: 1 },
  ]);
});
