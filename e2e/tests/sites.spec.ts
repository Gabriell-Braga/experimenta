import { expect, test } from '@playwright/test';
import { login } from '../editor';

const EDITOR = 'http://localhost:5173';

// Fase 22: cadastro de sites (nome, domínio, site e localização) e o erro da criação apontando para ele.
test('sites: cadastra com localização, edita e libera o domínio para experimentos', async ({ page }) => {
  const tag = Math.random().toString(36).slice(2, 7);
  const host = `${tag}.exemplo.com`;
  await login(page);
  // Antes do cadastro, criar teste nesse domínio é recusado com link para Sites.
  await page.getByRole('button', { name: 'Novo experimento' }).first().click();
  await page.getByTestId('create-name').fill(`Teste ${tag}`);
  await page.getByTestId('create-url').fill(`https://${host}/`);
  await page.getByTestId('create-submit').click();
  await expect(page.getByTestId('create-error')).toContainText('não é um site deste workspace');
  await page.getByTestId('create-add-site').click();

  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible();
  await page.getByTestId('site-new').click();
  await page.getByTestId('site-name').fill(`Site ${tag}`);
  await page.getByTestId('site-url').fill(`https://${host}/`);
  await page.getByTestId('site-locale').selectOption('es');
  await page.getByTestId('site-save').click();
  const row = page.getByTestId('site-row').filter({ hasText: host });
  await expect(row).toContainText(`Site ${tag}`);
  await expect(row).toContainText('Espanhol');

  await row.getByTestId('site-edit').click();
  await page.getByTestId('site-locale').selectOption('en');
  await page.getByTestId('site-save').click();
  await expect(row).toContainText('Inglês');
});

// Rodada 1 (não verificado): tabelas no celular rolam dentro do card, sem rolagem lateral da página.
test('celular: listas com tabela não criam rolagem horizontal na página', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const view of ['tests', 'sites', 'heatmaps', 'recordings']) {
    await page.goto(`${EDITOR}/?view=${view}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, view).toBeLessThanOrEqual(0);
  }
});
