import { ExperimentSchema, type TrackingEvent } from '@abtest/shared';
import { beforeAll, expect, test, vi } from 'vitest';
import { banditUser, rebalanceAll } from './bandit';
import { DEMO } from './seed';
import { ev, setupApp } from './test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const publish = vi.fn(async () => ({ version: 1 }));

const exp = (id: string, allocation: 'manual' | 'bandit', status = 'running') =>
  ExperimentSchema.parse({
    id,
    key: id.replace(/_/g, '-'),
    name: id,
    status,
    allocation,
    variations: [
      { id: `${id}_a`, key: 'a', name: 'A', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'B', weight: 50 },
    ],
    goals: [{ id: `${id}_g`, key: 'compra', type: 'custom', event: 'compra' }],
  });

beforeAll(async () => {
  t = await setupApp({ publish });
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  for (const e of [exp('ban_1', 'bandit'), exp('man_1', 'manual'), exp('ban_paused', 'bandit', 'paused')])
    await t.repo.saveExperiment(DEMO.accountId, {
      projectId,
      editorUrl: 'http://localhost:5180/',
      experiment: e,
    });
  // B converte 3× mais.
  const list: TrackingEvent[] = [];
  for (const id of ['ban_1', 'man_1'])
    for (let i = 0; i < 600; i++) {
      const arm = i % 2 ? 'b' : 'a';
      const base = {
        visitorId: `${id}-${i}`,
        experimentId: id,
        experimentKey: id,
        variationId: `${id}_${arm}`,
        variationKey: arm,
        ts: Date.now() - 10_000 + i,
      };
      list.push(ev({ type: 'exposure', ...base } as never));
      if ((i >> 1) % (arm === 'b' ? 5 : 15) === 0)
        list.push(
          ev({ type: 'conversion', ...base, ts: base.ts + 1, goalId: `${id}_g`, goalKey: 'compra' } as never),
        );
    }
  for (let i = 0; i < list.length; i += 150) await t.collect(list.slice(i, i + 150));
});

test('rebalanceamento manual: pesos seguem a chance de ser o melhor e republica', async () => {
  const r = await t.req('/experiments/ban_1/rebalance', { as: 'editor', method: 'POST' });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { changed: boolean; weights: number[] };
  expect(body.changed).toBe(true);
  expect(body.weights[1]!).toBeGreaterThan(900);
  expect(body.weights[0]!).toBeGreaterThanOrEqual(50);
  expect(publish).toHaveBeenCalledTimes(1);
  const saved = (await t.repo.getExperiment(DEMO.accountId, 'ban_1'))!.experiment;
  expect(saved.variations.map((v) => v.weight)).toEqual(body.weights);
  // Manual e pausado não são rebalanceados; viewer não pode.
  expect((await t.req('/experiments/man_1/rebalance', { as: 'editor', method: 'POST' })).status).toBe(404);
  expect((await t.req('/experiments/ban_paused/rebalance', { as: 'editor', method: 'POST' })).status).toBe(
    404,
  );
  expect((await t.req('/experiments/ban_1/rebalance', { as: 'viewer', method: 'POST' })).status).toBe(403);
});

test('job: só bandits em execução; sem mudança não republica; usuário de sistema sem permissão de JS', async () => {
  publish.mockClear();
  expect(await rebalanceAll(t.repo, publish)).toEqual([]); // pesos já atualizados
  expect(publish).not.toHaveBeenCalled();
  const ids = (await t.repo.listBanditExperiments()).map((e) => e.id);
  expect(ids).toEqual(['ban_1']);
  expect(banditUser('x')).toMatchObject({ role: 'editor', canPublishJs: false });
});
