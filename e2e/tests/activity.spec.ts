import { expect, test } from '@playwright/test';
import { createExperiment, EDITOR, login, nav } from '../editor';

// Histórico de atividades (16.3): linha do tempo no relatório e tela Configurar → Atividades com filtros.
test('criar um teste aparece na linha do tempo e na tela de atividades, com filtros', async ({ page }) => {
  const name = `Auditoria ${Date.now().toString(36)}`;
  await login(page);
  await createExperiment(page, name);
  const id = new URL(page.url()).searchParams.get('exp')!;

  await page.goto(`${EDITOR}?view=report&id=${encodeURIComponent(id)}`);
  await expect(page.getByTestId('activities')).toContainText(`Dona Demo criou o teste ${name}`);

  await nav(page, 'activity');
  await expect(page.getByTestId('activities')).toContainText(name);
  await page.getByLabel('Filtrar por tipo').selectOption('experiment');
  await expect(page).toHaveURL(/type=experiment/);
  await expect(page.getByTestId('activity').first()).toContainText('o teste');
  await page.getByLabel('Filtrar por pessoa').selectOption({ label: 'Leitor Demo' });
  await expect(page.getByTestId('activity-empty')).toBeVisible();

  // Filtros ficam na URL: recarregar mantém.
  await page.reload();
  await expect(page.getByLabel('Filtrar por tipo')).toHaveValue('experiment');
  await expect(page.getByTestId('activity-empty')).toBeVisible();
});
