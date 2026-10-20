import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('tipos de campanha: URL dividida, rollout no menu e server-side com variáveis', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  // URL dividida: variação redireciona para a outra página.
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('type-split').click();
  await page.getByTestId('create-name').fill(`Split ${Date.now()}`);
  await page.getByTestId('create-split-url').fill('http://localhost:5180/loja/');
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/\?exp=/);
  await expect(page.getByTestId('redirect-banner')).toContainText('localhost:5180/loja/');
  await page.getByTestId('back').click();

  // Rollout aparece filtrado no menu.
  const name = `Rollout ${Date.now()}`;
  await nav(page, 'tests:rollout');
  await page.getByTestId('new-experiment').click();
  await expect(page.getByTestId('type-rollout')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('create-name').fill(name);
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/\?exp=/);
  await expect(page.getByTestId('add-variation')).toHaveCount(0);
  await page.getByTestId('back').click();
  await nav(page, 'tests:rollout');
  await expect(page.getByTestId('experiment-row').filter({ hasText: name })).toBeVisible();

  // Server-side: página própria com variáveis JSON.
  await nav(page, 'tests:server');
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('create-name').fill(`Server ${Date.now()}`);
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/view=server/);
  await page.getByTestId('server-variables').nth(1).fill('{"cor": "verde"}');
  await page.getByTestId('server-save').click();
  await expect(page.getByTestId('notice').last()).toContainText('Salvo');
  await page.reload();
  await expect(page.getByTestId('server-variables').nth(1)).toHaveValue(/"cor": "verde"/);
  // Exemplo de uso por linguagem, com a conta e a chave da campanha.
  const snippets = page.getByTestId('sdk-snippets');
  await snippets.getByRole('tab', { name: 'PHP' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText("new Experimenta\\Client('demo'");
  await snippets.getByRole('tab', { name: 'Java' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText('abt.getVariation("');
  await snippets.getByRole('tab', { name: 'React Native' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText("useVariation('");
});
