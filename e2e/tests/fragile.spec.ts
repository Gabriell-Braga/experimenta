import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

test('seletor frágil: dica no painel, aviso ao criar a alteração e ⚠ na lista; estável não avisa', async ({
  page,
}) => {
  const site = await openEditor(page);

  // Estável: sem aviso.
  await site.locator('#hero-title').click({ button: 'right' });
  await site.locator('abt-editor-overlay').locator('[data-action=hide]').click();
  await expect(page.getByTestId('fragile-warning')).toHaveCount(0);

  // Frágil: item de lista sem id/classe (nth-of-type).
  await site.locator('.feature-list li').nth(1).click();
  await expect(page.getByTestId('fragility')).toHaveText('frágil');
  await expect(page.getByTestId('fragile-hint')).toBeVisible();
  await site.locator('.feature-list li').nth(1).click({ button: 'right' });
  await site.locator('abt-editor-overlay').locator('[data-action=hide]').click();
  await expect(page.getByTestId('fragile-warning')).toContainText('nth-of-type(2)');

  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('change').nth(0).getByTestId('fragile')).toHaveCount(0);
  await expect(page.getByTestId('change').nth(1).getByTestId('fragile')).toHaveCount(1);
});
