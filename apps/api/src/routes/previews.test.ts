import { ExperimentSchema, type Experiment } from '@abtest/shared';
import { beforeAll, expect, test } from 'vitest';
import { DEMO } from '../seed';
import { setupApp } from '../test-app';
import { PREVIEW_KIND, type PreviewData } from './previews';

let t: Awaited<ReturnType<typeof setupApp>>;
const op = (id: string, page?: string) => ({
  id,
  type: 'setText',
  target: { selector: 'h1', alternates: [] },
  value: id,
  order: 0,
  ...(page ? { page } : {}),
});
beforeAll(async () => {
  t = await setupApp();
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: ExperimentSchema.parse({
      id: 'pv',
      key: 'pv',
      name: 'Teste pv',
      status: 'draft',
      traffic: 10,
      audiences: ['aud_x'],
      segmentation: { devices: ['mobile'] },
      pages: [
        {
          id: 'p1',
          name: 'Home',
          url: 'http://localhost:5180/',
          match: { match: 'exact', value: 'http://localhost:5180/' },
        },
        {
          id: 'p2',
          name: 'Produto',
          url: 'http://localhost:5180/p',
          match: { match: 'contains', value: '/p' },
        },
      ],
      variations: [
        { id: 'pv_v0', key: 'controle', name: 'Controle', weight: 50 },
        {
          id: 'pv_v1',
          key: 'b',
          name: 'B',
          weight: 50,
          operations: [op('o1'), op('o2', 'p2')],
          customJS: 'window.x=1',
        },
      ],
    }),
  });
});

const create = (body: unknown, as = 'editor', id = 'pv') =>
  t.req(`/experiments/${id}/previews`, { method: 'POST', body: JSON.stringify(body), as });
const pub = (token: string, account = DEMO.accountId) => t.app.request(`/preview/${account}/${token}`);

test('link mostra o rascunho da variação (compilado, só ela, sempre no ar) sem publicar', async () => {
  const r = await create({ variationId: 'pv_v1', hours: 24 });
  expect(r.status).toBe(201);
  const link = (await r.json()) as { id: string; token: string; url: string; expiresAt: string };
  expect(link.url).toBe(`http://localhost:5180/?abt_preview=${encodeURIComponent(link.token)}`);
  expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(23 * 3_600_000);

  const res = await pub(link.token);
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  const { experiment } = (await res.json()) as { experiment: Experiment };
  expect(experiment).toMatchObject({ id: 'preview_pv', status: 'running', traffic: 100, audiences: [] });
  expect(experiment.segmentation.devices).toEqual([]);
  expect(experiment.variations.map((v) => v.id)).toEqual(['pv_v1']);
  // Funil compilado como na publicação: a 1ª página vira explícita.
  expect(experiment.variations[0]!.operations.map((o) => o.page)).toEqual(['p1', 'p2']);
  // Editor sem permissão de JS: o customJS do rascunho não roda no link.
  expect(experiment.variations[0]!.customJS).toBe('');
  // Nada foi publicado.
  expect(await t.repo.lastPublication(DEMO.accountId)).toBeFalsy();

  // Hash guardado, nunca o token.
  const saved = await t.repo.getEntity<PreviewData>(DEMO.accountId, PREVIEW_KIND, link.id);
  expect(JSON.stringify(saved)).not.toContain(link.token.split('.')[1]);

  // Owner: customJS vai junto.
  const own = (await (await create({ variationId: 'pv_v1', hours: 1 }, 'owner')).json()) as { token: string };
  const o = (await (await pub(own.token)).json()) as { experiment: Experiment };
  expect(o.experiment.variations[0]!.customJS).toBe('window.x=1');

  // Lista e auditoria.
  const list = await t.get<{ id: string; variationName: string }[]>('/experiments/pv/previews', 'viewer');
  expect(list.map((l) => l.variationName)).toEqual(['B', 'B']);
  const acts = await t.get<{ items: { action: string; targetId: string; detail: string }[] }>(
    '/activities?targetId=pv',
  );
  expect(acts.items.filter((a) => a.action === 'preview').map((a) => a.detail)).toContain('B · 24 h');
});

test('sem token válido, de outra conta, revogado ou expirado: nada', async () => {
  const { id, token } = (await (await create({ variationId: 'pv_v1', hours: 1 })).json()) as {
    id: string;
    token: string;
  };
  expect((await pub(`${id}.errado`)).status).toBe(404);
  expect((await pub('lixo')).status).toBe(404);
  expect((await pub(token, t.otherAccountId)).status).toBe(404);
  // Outra conta não lista nem revoga.
  expect((await t.req('/experiments/pv/previews', { as: 'other' })).status).toBe(404);
  expect((await t.req(`/experiments/pv/previews/${id}`, { method: 'DELETE', as: 'other' })).status).toBe(404);
  // Viewer não cria nem revoga.
  expect((await create({ variationId: 'pv_v1', hours: 1 }, 'viewer')).status).toBe(403);
  expect((await t.req(`/experiments/pv/previews/${id}`, { method: 'DELETE', as: 'viewer' })).status).toBe(
    403,
  );

  expect((await t.req(`/experiments/pv/previews/${id}`, { method: 'DELETE', as: 'editor' })).status).toBe(
    204,
  );
  expect((await pub(token)).status).toBe(404);
  const acts = await t.get<{ items: { action: string; detail: string }[] }>('/activities?targetId=pv');
  expect(acts.items.find((a) => a.action === 'preview_revoke')?.detail).toBe('B');

  // Expirado.
  const e = (await (await create({ variationId: 'pv_v1', hours: 1 })).json()) as {
    id: string;
    token: string;
  };
  const cur = (await t.repo.getEntity<PreviewData>(DEMO.accountId, PREVIEW_KIND, e.id))!;
  await t.repo.saveEntity(DEMO.accountId, {
    id: e.id,
    kind: PREVIEW_KIND,
    name: cur.name,
    data: { ...cur.data, expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  expect((await pub(e.token)).status).toBe(404);
  const list = await t.get<{ id: string }[]>('/experiments/pv/previews');
  expect(list.map((l) => l.id)).not.toContain(e.id);
  // Vencido sai ao criar o próximo.
  await create({ variationId: 'pv_v0', hours: 1 });
  expect(await t.repo.getEntity(DEMO.accountId, PREVIEW_KIND, e.id)).toBeNull();
});

test('validação: variação inexistente, validade fora da lista, rotas genéricas não expõem', async () => {
  expect((await create({ variationId: 'nao', hours: 1 })).status).toBe(400);
  expect((await create({ variationId: 'pv_v1', hours: 5 })).status).toBe(400);
  expect((await create({ variationId: 'pv_v1', hours: 1 }, 'editor', 'nao')).status).toBe(404);
  expect((await t.req('/entities/preview', { as: 'owner' })).status).toBe(400);
});
