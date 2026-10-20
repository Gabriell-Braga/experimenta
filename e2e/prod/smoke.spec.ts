import { expect, test } from '@playwright/test';

const EDITOR = process.env.PROD_EDITOR ?? 'https://experimenta.gabrielbraga.app/';
const DEMO = process.env.PROD_DEMO ?? 'https://experimenta-demo.gabrielbraga.app/';

test('produção: login → editar → configurar → publicar → visitante vê a variação', async ({
  page,
  browser,
}) => {
  test.skip(!process.env.PROD_PASSWORD, 'defina PROD_PASSWORD');
  await page.goto(EDITOR);
  await page.getByLabel('E-mail').fill('demo@abtest.dev');
  await page.getByLabel('Senha').fill(process.env.PROD_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('create-name').fill('Smoke');
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true', { timeout: 30_000 });
  const site = page.frameLocator('[data-testid=site-frame]');
  const texto = `Smoke ${Date.now().toString(36)}`;
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await page.keyboard.press('Enter');
  await expect(site.locator('#hero-title')).toHaveText(texto);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('running');
  await page.getByTestId('weight-controle').fill('0');
  await page.getByTestId('weight-controle').blur();
  await page.getByTestId('weight-variacao-1').fill('100');
  await page.getByTestId('weight-variacao-1').blur();
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('Publicado', { timeout: 30_000 });

  // CDN com cache de 60 s: o visitante pode ver a versão anterior por até 1 min.
  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await expect(async () => {
    await vp.goto(DEMO); // URL exata da segmentação (sem query)
    await expect(vp.locator('#hero-title')).toHaveText(texto, { timeout: 3000 });
  }).toPass({ timeout: 80_000, intervals: [5000] });
  await visitor.close();

  // Arquiva para não deixar o demo público alterado.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('archived');
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('não entra na publicação', {
    timeout: 30_000,
  });
});
