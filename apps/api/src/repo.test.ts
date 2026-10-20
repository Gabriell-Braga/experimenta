import { ExperimentSchema } from '@abtest/shared';
import { beforeAll, describe, expect, test } from 'vitest';
import { NotFoundError, retentionCutoff, verifyPassword, type Repo } from './repo';
import { testRepo } from './test-repo';

let repo: Repo;
let a: { id: string };
let b: { id: string };
let projA: { id: string };
let projB: { id: string };

const exp = (id: string, key = 'hero') =>
  ExperimentSchema.parse({
    id,
    key,
    name: 'Hero',
    goals: [{ id: `${id}_g1`, key: 'compra', type: 'click', selector: '.buy' }],
    variations: [
      { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
      {
        id: `${id}_v1`,
        key: 'b',
        name: 'B',
        weight: 50,
        customCSS: 'h1{color:red}',
        operations: [{ id: 'o1', order: 0, type: 'setText', target: { selector: 'h1' }, value: 'Oi' }],
      },
    ],
  });

beforeAll(async () => {
  repo = await testRepo();
  a = await repo.createAccount('Loja A');
  b = await repo.createAccount('Loja B');
  projA = await repo.createProject(a.id, { name: 'Site A', siteUrl: 'https://a.com' });
  projB = await repo.createProject(b.id, { name: 'Site B', siteUrl: 'https://b.com' });
});

describe('repositório', () => {
  test('migrações aplicadas e usuários com senha em hash', async () => {
    const u = await repo.createUser(a.id, {
      email: 'Ana@A.com',
      name: 'Ana',
      password: 'segredo123',
      role: 'owner',
    });
    expect(u.passwordHash).not.toContain('segredo123');
    expect(await verifyPassword('segredo123', u.passwordHash)).toBe(true);
    expect(await verifyPassword('errada', u.passwordHash)).toBe(false);
    expect((await repo.findUserByEmail('ana@a.com'))?.id).toBe(u.id);
  });

  test('salva e lê o experimento completo; cada salvamento cria uma versão', async () => {
    const e = exp('exp_a1');
    expect(
      await repo.saveExperiment(a.id, { projectId: projA.id, editorUrl: 'https://a.com/', experiment: e }),
    ).toBe(1);
    const changed = {
      ...e,
      name: 'Hero 2',
      variations: [e.variations[0]!, { ...e.variations[1]!, weight: 30 }],
    };
    expect(
      await repo.saveExperiment(a.id, {
        projectId: projA.id,
        editorUrl: 'https://a.com/',
        experiment: changed,
      }),
    ).toBe(2);
    const r = (await repo.getExperiment(a.id, 'exp_a1'))!;
    expect(r.experiment).toEqual(ExperimentSchema.parse(changed));
    expect((await repo.listVersions(a.id, 'exp_a1')).map((v) => v.version)).toEqual([2, 1]);
    expect((await repo.getVersion(a.id, 'exp_a1', 1))!.experiment.name).toBe('Hero');
  });

  test('tipo de campanha, MVT, alocação, audiências e extras da variação sobrevivem ao salvar', async () => {
    const e = ExperimentSchema.parse({
      ...exp('e_opts', 'opts'),
      type: 'mvt',
      allocation: 'bandit',
      audiences: ['aud_1'],
      sections: [
        {
          id: 's1',
          name: 'Título',
          options: [
            { id: 'o0', name: 'Original' },
            {
              id: 'o1',
              name: 'Curto',
              operations: [{ id: 'op', order: 0, type: 'setText', target: { selector: 'h1' }, value: 'X' }],
            },
          ],
        },
      ],
      variations: [
        { id: 'e_opts_v0', key: 'c', name: 'C', weight: 1, combination: { s1: 'o0' } },
        {
          id: 'e_opts_v1',
          key: 'b',
          name: 'B',
          weight: 1,
          combination: { s1: 'o1' },
          variables: { cor: 'verde', n: 3 },
        },
      ],
    });
    const c = await repo.createAccount('Loja C');
    const projC = await repo.createProject(c.id, { name: 'Site C', siteUrl: 'https://c.com' });
    await repo.saveExperiment(c.id, { projectId: projC.id, editorUrl: 'https://c.com/', experiment: e });
    expect((await repo.getExperiment(c.id, 'e_opts'))!.experiment).toEqual(e);
    // Experimento sem opções recebe os padrões.
    await repo.saveExperiment(c.id, {
      projectId: projC.id,
      editorUrl: 'https://c.com/',
      experiment: exp('e_plain', 'plain'),
    });
    expect((await repo.getExperiment(c.id, 'e_plain'))?.experiment).toMatchObject({
      type: 'ab',
      allocation: 'manual',
      audiences: [],
    });
  });

  test('teste multipágina: páginas e a página de cada operação sobrevivem ao salvar', async () => {
    const base = exp('e_funil', 'funil');
    const e = ExperimentSchema.parse({
      ...base,
      pages: [
        {
          id: 'p1',
          name: 'Carrinho',
          url: 'https://a.com/carrinho',
          match: { match: 'contains', value: '/carrinho' },
        },
        {
          id: 'p2',
          name: 'Pagamento',
          url: 'https://a.com/pagar',
          match: { match: 'exact', value: 'https://a.com/pagar' },
        },
      ],
      variations: base.variations.map((v) => ({
        ...v,
        operations: v.operations.map((o) => ({ ...o, page: 'p2' })),
      })),
    });
    const d = await repo.createAccount('Loja D');
    const projD = await repo.createProject(d.id, { name: 'Site D', siteUrl: 'https://a.com' });
    await repo.saveExperiment(d.id, {
      projectId: projD.id,
      editorUrl: 'https://a.com/carrinho',
      experiment: e,
    });
    expect((await repo.getExperiment(d.id, 'e_funil'))!.experiment).toEqual(e);
    // Experimento sem páginas (como os salvos antes do recurso) continua sem.
    await repo.saveExperiment(d.id, { projectId: projD.id, editorUrl: 'https://a.com/', experiment: base });
    expect((await repo.getExperiment(d.id, 'e_funil'))?.experiment.pages).toBeUndefined();
  });

  test('isolamento por conta: outra conta não lê, não lista, não sobrescreve nem apaga', async () => {
    await repo.saveExperiment(a.id, {
      projectId: projA.id,
      editorUrl: 'https://a.com/',
      experiment: exp('exp_a2', 'outro'),
    });
    expect(await repo.getExperiment(b.id, 'exp_a2')).toBeNull();
    expect((await repo.listExperiments(b.id)).map((e) => e.id)).toEqual([]);
    expect(await repo.listVersions(b.id, 'exp_a2')).toEqual([]);
    expect(await repo.getVersion(b.id, 'exp_a2', 1)).toBeUndefined();
    // Mesmo id de experimento enviado pela conta B → recusado.
    await expect(
      repo.saveExperiment(b.id, { projectId: projB.id, editorUrl: 'x', experiment: exp('exp_a2', 'hack') }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Projeto de outra conta → recusado.
    await expect(
      repo.saveExperiment(b.id, { projectId: projA.id, editorUrl: 'x', experiment: exp('exp_b1') }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await repo.deleteExperiment(b.id, 'exp_a2')).toBe(false);
    expect((await repo.getExperiment(a.id, 'exp_a2'))?.experiment.key).toBe('outro');
    expect(await repo.getProject(b.id, projA.id)).toBeUndefined();
  });

  test('troca atômica de entidade: só quem leu a versão atual grava', async () => {
    const id = await repo.saveEntity(a.id, { kind: 'job', name: 'j', data: { n: 0 } });
    const v0 = (await repo.getEntity(a.id, 'job', id))!.updatedAt;
    const v1 = await repo.swapEntity(a.id, 'job', id, v0, { n: 1 });
    expect(v1).not.toBeNull();
    // Segunda troca com a versão velha perde (é o que impede dois passos simultâneos).
    expect(await repo.swapEntity(a.id, 'job', id, v0, { n: 2 })).toBeNull();
    expect(await repo.swapEntity(b.id, 'job', id, v1!, { n: 3 })).toBeNull();
    expect(await repo.swapEntity(a.id, 'job', id, v1!, { n: 4 })).not.toBeNull();
    const e = (await repo.getEntity<{ n: number }>(a.id, 'job', id))!;
    expect(e.data.n).toBe(4);
    expect(Date.parse(e.updatedAt)).toBeGreaterThan(Date.parse(v1!));
  });

  test('chave do experimento é única por conta (não global)', async () => {
    await repo.saveExperiment(b.id, {
      projectId: projB.id,
      editorUrl: 'x',
      experiment: exp('exp_b2', 'hero'),
    });
    await expect(
      repo.saveExperiment(b.id, { projectId: projB.id, editorUrl: 'x', experiment: exp('exp_b3', 'hero') }),
    ).rejects.toThrow();
  });

  test('loadAllExperiments e publicações por conta', async () => {
    expect((await repo.loadAllExperiments(a.id)).map((e) => e.id).sort()).toEqual(['exp_a1', 'exp_a2']);
    await repo.insertPublication(a.id, {
      accountId: a.id,
      version: 1,
      publishedAt: new Date().toISOString(),
      experiments: [],
    });
    expect((await repo.lastPublication(a.id))?.version).toBe(1);
    expect(await repo.lastPublication(b.id)).toBeUndefined();
  });

  test('configurações da conta e expurgo de eventos antigos', async () => {
    expect(await repo.getAccountSettings(a.id)).toEqual({ heatmapSampleRate: null, requireApproval: false });
    await repo.updateAccountSettings(a.id, { heatmapSampleRate: 0.1, requireApproval: true });
    expect(await repo.getAccountSettings(a.id)).toEqual({ heatmapSampleRate: 0.1, requireApproval: true });
    expect(await repo.getAccountSettings(b.id)).toEqual({ heatmapSampleRate: null, requireApproval: false });

    const ev = (id: string) =>
      ({
        type: 'exposure',
        eventId: id,
        ts: Date.now(),
        accountId: a.id,
        visitorId: 'v',
        url: 'https://a.com/',
        experimentId: 'exp_a1',
        experimentKey: 'hero',
        variationId: 'exp_a1_v1',
        variationKey: 'b',
      }) as const;
    await repo.insertEvents(a.id, [ev('e1'), ev('e2')]);
    const exposures = async () => (await repo.experimentHealth(a.id, 'exp_a1')).exposures['exp_a1_v1'] ?? 0;
    expect(await exposures()).toBe(2);
    await repo.purgeEventsBefore(new Date(Date.now() - 86_400_000)); // corte no passado: nada sai
    expect(await exposures()).toBe(2);
    await repo.purgeEventsBefore(new Date(Date.now() + 60_000));
    expect(await exposures()).toBe(0);
    expect(retentionCutoff(90, 100 * 86_400_000)).toEqual(new Date(10 * 86_400_000));
    expect(retentionCutoff(0)).toBeNull();
  });
});
