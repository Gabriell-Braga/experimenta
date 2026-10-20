import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentSchema, type Group, type PublishedConfig, type SdkConfig } from '@abtest/shared';
import { assign } from '@abtest/snippet/bucket';
import { beforeAll, expect, test } from 'vitest';
import { fsCdnStore } from '../cdn-fs';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
let cdnDir: string;
beforeAll(async () => {
  cdnDir = mkdtempSync(join(tmpdir(), 'abt-grp-'));
  writeFileSync(join(cdnDir, 'abt.js'), '/*runtime*/');
  t = await setupApp({ cdn: fsCdnStore(cdnDir) });
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  for (const [id, type] of [
    ['g_a', 'ab'],
    ['g_b', 'ab'],
    ['g_c', 'ab'],
    ['g_srv', 'server'],
  ] as const)
    await t.repo.saveExperiment(DEMO.accountId, {
      projectId,
      editorUrl: 'http://localhost:5180/',
      experiment: ExperimentSchema.parse({
        id,
        key: id,
        name: `Teste ${id}`,
        status: 'running',
        type,
        variations: [
          { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
          { id: `${id}_v1`, key: 'b', name: 'B', weight: 50 },
        ],
      }),
    });
});

const send = (method: string, path: string, body?: unknown, as = 'owner') =>
  t.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), as });
const saveGroup = (name: string, experiments: Group['experiments'], id?: string, as = 'owner') =>
  send(id ? 'PUT' : 'POST', `/entities/group${id ? `/${id}` : ''}`, { name, data: { experiments } }, as);
const slotsOf = async (id: string) => (await t.get<{ data: Group }>(`/entities/group/${id}`)).data.slots!;

test('grupo: fatias calculadas pela API, mexendo o mínimo quando o grupo muda', async () => {
  const r = await saveGroup('Checkout', [
    { id: 'g_a', percent: 50 },
    { id: 'g_b', percent: 30 },
  ]);
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  const s1 = await slotsOf(id);
  expect(s1.filter((x) => x === 'g_a')).toHaveLength(50);
  expect(s1.filter((x) => x === 'g_b')).toHaveLength(30);
  expect(s1.filter((x) => !x)).toHaveLength(20);

  // A cai para 40, entra C com 30: quem era de B continua em B; só 10 fatias de A mudam de dono.
  expect(
    (
      await saveGroup(
        'Checkout',
        [
          { id: 'g_a', percent: 40 },
          { id: 'g_b', percent: 30 },
          { id: 'g_c', percent: 30 },
        ],
        id,
      )
    ).status,
  ).toBe(200);
  const s2 = await slotsOf(id);
  s1.forEach((owner, i) => owner === 'g_b' && expect(s2[i]).toBe('g_b'));
  expect(s2.filter((x, i) => x === 'g_a' && s1[i] === 'g_a')).toHaveLength(40);
  expect(s2.filter((x) => x === 'g_c')).toHaveLength(30);
  expect(s2.filter((x) => !x)).toHaveLength(0);
  // Fatias mandadas pelo cliente são ignoradas.
  await send('PUT', `/entities/group/${id}`, {
    name: 'Checkout',
    data: { experiments: [{ id: 'g_a', percent: 40 }], slots: Array(100).fill('g_a') },
  });
  expect((await slotsOf(id)).filter((x) => x === 'g_a')).toHaveLength(40);
  // Volta ao estado anterior para os próximos testes.
  await saveGroup(
    'Checkout',
    [
      { id: 'g_a', percent: 40 },
      { id: 'g_b', percent: 30 },
      { id: 'g_c', percent: 30 },
    ],
    id,
  );
});

test('validação: soma > 100, repetido, experimento de fora da conta ou já em outro grupo → 400', async () => {
  const bad = async (experiments: Group['experiments']) => {
    const r = await saveGroup('Ruim', experiments);
    expect(r.status).toBe(400);
    return ((await r.json()) as { error: string }).error;
  };
  await bad([
    { id: 'g_srv', percent: 60 },
    { id: 'outro', percent: 50 },
  ]);
  await bad([
    { id: 'g_srv', percent: 10 },
    { id: 'g_srv', percent: 10 },
  ]);
  expect(await bad([{ id: 'nao_existe', percent: 10 }])).toMatch(/não encontrado/);
  expect(await bad([{ id: 'g_a', percent: 10 }])).toMatch(/já está no grupo "Checkout"/);
  // Viewer não grava; outra conta não enxerga os experimentos desta.
  expect((await saveGroup('V', [{ id: 'g_srv', percent: 10 }], undefined, 'viewer')).status).toBe(403);
  expect((await saveGroup('O', [{ id: 'g_srv', percent: 10 }], undefined, 'other')).status).toBe(400);
});

test('publicação: cada experimento leva o grupo e fatias disjuntas; o visitante cai em no máximo um', async () => {
  const srv = (await (await saveGroup('Backend', [{ id: 'g_srv', percent: 50 }])).json()) as { id: string };
  expect((await send('POST', '/publish')).status).toBe(200);
  const cfg = JSON.parse(readFileSync(join(cdnDir, 'demo.json'), 'utf8')) as PublishedConfig;
  const byId = new Map(cfg.experiments.map((e) => [e.id, e]));
  const [a, b, c] = ['g_a', 'g_b', 'g_c'].map((id) => byId.get(id)!.group!) as [
    { id: string; slots: number[] },
    { id: string; slots: number[] },
    { id: string; slots: number[] },
  ];
  expect(a.id).toBe(b.id);
  expect([...a.slots, ...b.slots, ...c.slots].sort((x, y) => x - y)).toEqual([...Array(100).keys()]);
  const sdk = JSON.parse(readFileSync(join(cdnDir, 'demo.sdk.json'), 'utf8')) as SdkConfig;
  expect(sdk.experiments.find((e) => e.id === 'g_srv')!.group).toEqual({
    id: srv.id,
    slots: [...Array(50).keys()],
  });

  const exps = ['g_a', 'g_b', 'g_c'].map((id) => byId.get(id)!);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const inside = exps.filter((e) => assign(`v${i}`, e, {}));
    expect(inside.length).toBeLessThanOrEqual(1);
    inside.forEach((e) => seen.add(e.id));
  }
  expect(seen.size).toBe(3);
});

test('auditoria: criar, editar e excluir grupo entram nas atividades', async () => {
  const r = await saveGroup('Temporário', [{ id: 'g_srv', percent: 1 }]);
  expect(r.status).toBe(400); // g_srv já está em "Backend"
  const { id } = (await (await saveGroup('Temporário', [])).json()) as { id: string };
  await saveGroup('Temporário 2', [], id);
  expect((await send('DELETE', `/entities/group/${id}`)).status).toBe(204);
  const { items } = await t.get<{ items: { action: string; targetType: string; targetId: string }[] }>(
    `/activities?targetId=${id}`,
  );
  expect(items.map((a) => [a.action, a.targetType])).toEqual([
    ['delete', 'group'],
    ['update', 'group'],
    ['create', 'group'],
  ]);
});
