import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

// Plano grátis do Worker: estouro de CPU chega ao navegador como "Failed to fetch" (503 sem CORS). Se a API ainda
// responde ao /health, o editor diz que é limite da versão de testes; se nem o /health responde, é conexão.
test('requisição derrubada com a API no ar mostra "limite da versão de testes"; com a API fora, "sem conexão"', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();

  // Os 4 blocos do painel caem juntos: um aviso só (antes saíam repetidos, um por requisição).
  await page.route('**/analytics/dashboard/**', (r) => r.abort('failed'));
  await nav(page, 'home');
  const limit = page.getByTestId('notice').filter({ hasText: 'Limite da versão de testes' });
  await expect(limit).toHaveCount(1);
  await expect(page.getByTestId('block-failed').first()).toBeVisible();
  await expect(page.getByTestId('toast-error')).toHaveCount(0);

  await page.route('**/health', (r) => r.abort('failed'));
  await limit.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByTestId('toast-error').filter({ hasText: 'Sem conexão com a API' })).toBeVisible();
});
