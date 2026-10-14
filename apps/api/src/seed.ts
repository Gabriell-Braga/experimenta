import type { Repo } from './repo';

export const DEMO = {
  accountId: 'demo',
  owner: { email: 'demo@abtest.dev', password: 'demo1234' },
  editor: { email: 'editor@abtest.dev', password: 'demo1234' },
  viewer: { email: 'viewer@abtest.dev', password: 'demo1234' },
};

/** Dados de desenvolvimento: conta "demo" com um usuário de cada papel e o projeto do site demo. */
export async function seedDev(repo: Repo, siteUrl = 'http://localhost:5180/'): Promise<void> {
  if (await repo.findUserByEmail(DEMO.owner.email)) return;
  await repo.createAccount('Loja Demo', DEMO.accountId);
  await repo.createUser(DEMO.accountId, {
    ...DEMO.owner,
    name: 'Dona Demo',
    role: 'owner',
    canPublishJs: true,
  });
  await repo.createUser(DEMO.accountId, { ...DEMO.editor, name: 'Editor Demo', role: 'editor' });
  await repo.createUser(DEMO.accountId, { ...DEMO.viewer, name: 'Leitor Demo', role: 'viewer' });
  await repo.createProject(DEMO.accountId, { name: 'Site demo', siteUrl });
}
