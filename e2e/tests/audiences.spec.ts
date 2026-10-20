import { expect, test } from '@playwright/test';
import { createExperiment, login, nav } from '../editor';

test('audiência: só quem atende às regras entra no experimento', async ({ page, browser }) => {
  await login(page);
  // Audiência "voltou": 2+ páginas vistas.
  await nav(page, 'audiences');
  await page.getByTestId('new-audience').click();
  const name = `Voltou ${Date.now()}`;
  await page.getByTestId('audience-name').fill(name);
  await page.getByTestId('audience-rule').locator('input[type=number]').fill('2');
  await page.getByTestId('audience-save').click();
  await expect(page.getByTestId('audiences')).toContainText(name);

  // Experimento com texto novo no título, restrito à audiência, em execução.
  await nav(page, 'tests');
  await createExperiment(page);
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  const site = page.frameLocator('[data-testid=site-frame]');
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Bem-vindo de volta');
  await page.keyboard.press('Enter');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('running');
  await page.getByTestId('audiences-picker').getByText(name).click();
  // Tudo na variação: quem atende à audiência sempre vê a mudança.
  await page.getByTestId('weight-controle').fill('0');
  await page.getByTestId('weight-controle').blur();
  await page.getByTestId('weight-variacao-1').fill('100');
  await page.getByTestId('weight-variacao-1').blur();
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('Publicado');

  // Visitante novo: 1ª página não vê; 2ª página (mesmo visitante) vê.
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto('http://localhost:5180/?abt_nocache=1');
  await expect(v.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await v.goto('http://localhost:5180/');
  await expect(v.locator('#hero-title')).toHaveText('Bem-vindo de volta');
  await ctx.close();

  // Não deixa experimento em execução para os outros testes.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('archived');
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
});
