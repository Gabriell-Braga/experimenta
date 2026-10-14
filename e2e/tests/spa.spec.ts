import { expect, test } from '@playwright/test';
import { makeConfig, serveSnippet } from '../helpers';

test('SPA: navegação por rotas ativa, reverte e reaplica sem flicker', async ({ page }) => {
  await serveSnippet(
    page,
    makeConfig([
      {
        id: 'e-planos',
        key: 'planos',
        name: 'Planos',
        status: 'running',
        segmentation: { urls: [{ match: 'contains', value: '/spa/planos' }] },
        variations: [
          { id: 'v0', key: 'controle', name: 'Controle', weight: 0 },
          {
            id: 'v1',
            key: 'b',
            name: 'B',
            weight: 1,
            operations: [
              {
                id: 'o1',
                order: 0,
                type: 'setText',
                target: { selector: '[data-track="assinar"]' },
                value: 'Assinar já',
              },
            ],
          },
        ],
      },
    ]),
  );
  // Amostra o botão a cada frame para garantir que o texto original nunca aparece.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const loop = () => {
      const b = document.querySelector('[data-track="assinar"]') as HTMLElement | null;
      if (b && getComputedStyle(b).visibility !== 'hidden') seen.push(b.textContent ?? '');
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  await page.goto('/spa/');
  await expect(page.getByRole('heading', { name: 'Bem-vindo à SPA' })).toBeVisible();

  await page.getByRole('link', { name: 'Planos' }).click();
  await expect(page.locator('[data-track="assinar"]')).toHaveText('Assinar já');

  await page.getByRole('link', { name: 'Sobre' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre' })).toBeVisible();

  await page.goBack();
  await expect(page.locator('[data-track="assinar"]')).toHaveText('Assinar já');

  // Recarregar direto na rota também aplica.
  await page.reload();
  await expect(page.locator('[data-track="assinar"]')).toHaveText('Assinar já');

  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.length).toBeGreaterThan(0);
  expect(new Set(seen)).toEqual(new Set(['Assinar já']));
});
