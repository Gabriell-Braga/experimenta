import { expect, test } from '@playwright/test';

// Passa por todas as telas em produção com cada papel: nenhuma pode quebrar (erro de JS, resposta 5xx da API
// ou aviso de erro na tela). Também abre o relatório de cada teste rodando.
const EDITOR = process.env.PROD_EDITOR ?? 'https://experimenta.gabrielbraga.app/';
const API = process.env.PROD_API ?? 'https://experimenta-api.gabrielbraga.app';
const VIEWS = [
  'home',
  'tests',
  'mentions',
  'install',
  'integrations',
  'privacy',
  'team',
  'security',
  'activity',
  'approvals',
  'events',
  'flags',
  'groups',
  'optimize',
  'popups',
  'profiles',
  'segments',
  'recos',
  'surveys',
  'audiences',
  'heatmaps',
  'forms',
  'funnels',
  'journeys',
  'cohorts',
  'predictive',
  'recordings',
];

for (const email of ['demo@abtest.dev', 'editor@abtest.dev', 'viewer@abtest.dev'])
  test(`produção: todas as telas abrem sem erro (${email})`, async ({ page }) => {
    test.skip(!process.env.PROD_PASSWORD, 'defina PROD_PASSWORD');
    test.setTimeout(300_000);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`JS: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    await page.goto(EDITOR);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(process.env.PROD_PASSWORD!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByLabel('Senha')).toBeHidden({ timeout: 30_000 });

    const visit = async (search: string) => {
      await page.goto(`${EDITOR}${search}`);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      const alerts = await page.locator('[role=alert]').allInnerTexts();
      for (const a of alerts) if (/erro|falh/i.test(a)) problems.push(`${search}: ${a.trim().slice(0, 200)}`);
    };
    for (const v of VIEWS) await visit(`?view=${v}`);

    const login = await page.request.post(`${API}/auth/login`, {
      data: { email, password: process.env.PROD_PASSWORD },
    });
    const headers = { authorization: `Bearer ${(await login.json()).token}` };
    const exps = (await (await page.request.get(`${API}/experiments`, { headers })).json()) as {
      id: string;
      status: string;
    }[];
    for (const e of exps.filter((x) => x.status === 'running')) await visit(`?view=report&id=${e.id}`);

    expect(problems, problems.join('\n')).toEqual([]);
  });
