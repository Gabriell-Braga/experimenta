import type { Repo } from './repo';

export const DEMO = {
  accountId: 'demo',
  /** Segundo workspace do demo (site SaaS em /saas/, snippet `fluxo.js`): mesmas pessoas, papéis iguais. */
  saasAccountId: 'fluxo',
  owner: { email: 'demo@abtest.dev', password: 'demo1234' },
  editor: { email: 'editor@abtest.dev', password: 'demo1234' },
  viewer: { email: 'viewer@abtest.dev', password: 'demo1234' },
};

/**
 * Conta "demo" com um usuário de cada papel e o projeto do site demo.
 * Em dev a senha é `demo1234`; no deploy vem do segredo SEED_PASSWORD.
 */
export async function seedDev(
  repo: Repo,
  siteUrl = 'http://localhost:5180/',
  password?: string,
): Promise<void> {
  const pw = password ? { password } : {};
  if (await repo.findUserByEmail(DEMO.owner.email)) return seedSaas(repo, siteUrl);
  await repo.createAccount('Loja Demo', DEMO.accountId);
  await repo.createUser(DEMO.accountId, {
    ...DEMO.owner,
    ...pw,
    name: 'Dona Demo',
    role: 'owner',
    canPublishJs: true,
  });
  await repo.createUser(DEMO.accountId, { ...DEMO.editor, ...pw, name: 'Editor Demo', role: 'editor' });
  await repo.createUser(DEMO.accountId, { ...DEMO.viewer, ...pw, name: 'Leitor Demo', role: 'viewer' });
  await repo.createProject(DEMO.accountId, { name: 'Site demo', siteUrl });
  await seedSaas(repo, siteUrl);
}

/** Workspace "Fluxo (SaaS)": criado uma vez, também em bancos que já tinham a conta demo. */
async function seedSaas(repo: Repo, siteUrl: string): Promise<void> {
  if (await repo.accountExists(DEMO.saasAccountId)) return;
  await repo.createAccount('Fluxo (SaaS)', DEMO.saasAccountId);
  for (const m of await repo.listMembers(DEMO.accountId))
    await repo.addMember(DEMO.saasAccountId, m.id, { role: m.role, canPublishJs: m.canPublishJs });
  await repo.createProject(DEMO.saasAccountId, {
    name: 'Fluxo (SaaS)',
    siteUrl: new URL('saas/', siteUrl).href,
  });
}
