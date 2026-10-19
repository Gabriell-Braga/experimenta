import { expect, test } from '@playwright/test';
import { login } from '../editor';

test('pesquisa NPS: cria, publica, visitante responde e o relatório mostra o NPS', async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByTestId('nav-surveys').click();
  await page.getByTestId('new-survey').click();
  const name = `NPS ${Date.now()}`;
  await page.getByTestId('survey-name').fill(name);
  await expect(page.getByTestId('survey-preview').locator('abt-engage')).toHaveCount(1);
  await page.getByTestId('engage-trigger').selectOption('load');
  await page.getByTestId('survey-publish').click();
  await expect(page.getByTestId('survey-row').filter({ hasText: name })).toBeVisible();

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto('http://localhost:5180/produto.html');
  const w = v.locator('abt-engage');
  await expect(w.getByRole('dialog', { name: 'Pesquisa' })).toBeVisible({ timeout: 15_000 });
  await w.getByRole('button', { name: '10', exact: true }).click();
  await w.getByRole('button', { name: 'Próxima' }).click();
  await w.locator('textarea').fill('Entrega muito rápida');
  await w.getByRole('button', { name: 'Enviar' }).click();
  await expect(w).toContainText('Obrigado');
  await ctx.close();

  await page.getByTestId('survey-row').filter({ hasText: name }).getByRole('button', { name: name }).click();
  await expect(page.getByTestId('nps-score')).toHaveText('100', { timeout: 10_000 });
  await expect(page.getByTestId('survey-report')).toContainText('Entrega muito rápida');

  await page.getByTestId('nav-surveys').click();
  await page
    .getByTestId('survey-row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Pausar' })
    .click();
  await expect(page.getByTestId('notice').last()).toContainText('Pausada');
});
