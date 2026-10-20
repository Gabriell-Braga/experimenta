import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('ideias da IA: geração em passos continua ao voltar à tela e o resultado fica guardado', async ({
  page,
}) => {
  await login(page);
  await nav(page, 'optimize');
  await page.getByTestId('ideas-run').click();
  // O primeiro passo sai 1,5 s depois do início: dá para ver o progresso.
  await expect(page.getByTestId('ideas-source')).toContainText('Calculando o painel do período');
  // Sai da tela no meio da geração e volta depois: a tela retoma os passos.
  await nav(page, 'flags');
  await nav(page, 'optimize');
  await expect(page.getByTestId('ideas-source')).toContainText('Última geração', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('ideas-source')).toContainText('Última geração');
});
