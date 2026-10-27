import { expect, test } from '@playwright/test';
import { login } from '../editor';

test('multivariado: opções por seção viram combinações; edição vai para a opção', async ({ page }) => {
  await login(page);
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('type-mvt').click();
  await page.getByTestId('create-name').fill(`MVT ${Date.now()}`);
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  const site = page.frameLocator('[data-testid=site-frame]');

  // Seção 1, opção 1 ativa: muda o título.
  await expect(page.getByTestId('mvt-option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Corra mais');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mvt-option').nth(1)).toContainText('(1)');

  // Original da seção não tem a mudança.
  await page.getByTestId('mvt-option').nth(0).click();
  await expect(site.locator('#hero-title')).toHaveText('O melhor tênis para correr');

  // Nova seção e opção extra: 2 × 3 = 6 combinações nas configurações.
  await page.getByTestId('mvt-add-section').click();
  await page.getByTestId('mvt-add-option').nth(1).click();
  await expect(page.getByTestId('mvt-section')).toHaveCount(2);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-step-variation').click();
  await expect(page.getByTestId('settings-modal').locator('[data-testid^=weight-]')).toHaveCount(6);
  await page.getByTestId('settings-done').click();

  // Recarregar mantém seções, opções e a mudança.
  await page.reload();
  await expect(page.getByTestId('mvt-section')).toHaveCount(2);
  await page.getByTestId('mvt-option').nth(1).click();
  await expect(site.locator('#hero-title')).toHaveText('Corra mais');
});
