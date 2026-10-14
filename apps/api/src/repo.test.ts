import { ExperimentSchema } from '@abtest/shared';
import { beforeAll, describe, expect, test } from 'vitest';
import { createDb } from './db';
import { createRepo, NotFoundError, verifyPassword, type Repo } from './repo';

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
  repo = createRepo(await createDb());
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
    expect(verifyPassword('segredo123', u.passwordHash)).toBe(true);
    expect(verifyPassword('errada', u.passwordHash)).toBe(false);
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
});
