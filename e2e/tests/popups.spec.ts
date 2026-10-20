import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('pop-up: cria com pré-visualização, publica, aparece no site e registra exibição', async ({
  page,
  browser,
}) => {
  await login(page);
  await nav(page, 'popups');
  await page.getByTestId('new-popup').click();
  const title = `Oferta ${Date.now()}`;
  await page.getByTestId('popup-name').fill(title);
  await page.getByTestId('popup-title').fill(title);
  await expect(page.getByTestId('popup-preview').locator('abt-engage')).toHaveCount(1);
  await page.getByTestId('engage-trigger').selectOption('load');
  // Só na página deste teste: os outros rodam em paralelo na mesma conta.
  const tag = Date.now();
  await page.getByTestId('engage-add-url').click();
  await page.getByTestId('engage-url').fill(`e2e=${tag}`);
  await page.getByTestId('popup-publish').click();
  await expect(page.getByTestId('popup-row').filter({ hasText: title })).toBeVisible();

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(`http://localhost:5180/?e2e=${tag}`);
  const host = v.locator('abt-engage');
  await expect(host.locator('h2')).toHaveText(title, { timeout: 15_000 });
  await host.getByRole('button', { name: 'Fechar' }).click();
  await expect(host).toHaveCount(0);
  // Frequência "uma vez": não volta.
  await v.reload();
  await v.waitForTimeout(800);
  await expect(v.locator('abt-engage')).toHaveCount(0);
  await ctx.close();

  // Pausa (não deixa pop-up no ar para os outros testes).
  await page.reload();
  await page
    .getByTestId('popup-row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'Pausar' })
    .click();
  await expect(page.getByTestId('notice').last()).toContainText('Pausado');
});
