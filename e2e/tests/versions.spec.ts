import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

test('histórico de versões: restaurar versão anterior como nova versão', async ({ page }) => {
  const site = await openEditor(page); // v1 = experimento vazio
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Versão dois');
  await page.keyboard.press('Enter');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo'); // v2
  await expect(site.locator('#hero-title')).toHaveText('Versão dois');

  await page.getByTestId('side-versions').click();
  await expect(page.getByTestId('version')).toHaveCount(2);
  await page.getByTestId('version').nth(1).getByTestId('restore').click();
  await page.getByTestId('restore-confirm').click();

  // Recarrega com a v1 restaurada (como v3): sem alterações.
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  await expect(site.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await expect(page.getByTestId('tab-variacao-1')).not.toContainText('(');
  await page.getByTestId('side-versions').click();
  await expect(page.getByTestId('version')).toHaveCount(3);
  await expect(page.getByTestId('version').first()).toContainText('v3');
});
