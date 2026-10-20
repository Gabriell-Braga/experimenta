import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('ideias da IA: geração segue fora da tela e o resultado fica guardado', async ({ page }) => {
  await login(page);
  await nav(page, 'optimize');
  await page.getByTestId('ideas-run').click();
  await expect(page.getByTestId('ideas-source')).toContainText('segundo plano');
  // Sai da tela no meio da geração e volta depois.
  await nav(page, 'flags');
  await nav(page, 'optimize');
  await expect(page.getByTestId('ideas-source')).toContainText('Última geração', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('ideas-source')).toContainText('Última geração');
});
