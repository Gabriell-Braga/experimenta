import { expect, test } from '@playwright/test';
import { login } from '../editor';
import { makeConfig, serveSnippet } from '../helpers';

const API = 'http://localhost:4000';

test('gravação: visitante amostrado é gravado (campos mascarados) e a sessão toca no player', async ({
  browser,
  page,
}) => {
  // Visitante num contexto separado (cookies próprios).
  const ctx = await browser.newContext();
  const site = await ctx.newPage();
  await serveSnippet(
    site,
    makeConfig([], {
      apiUrl: API,
      trackingUrl: `${API}/collect`,
      heatmap: { sampleRate: 1, recordings: true, forms: true },
    }),
  );
  await site.goto('/');
  await site.locator('#newsletter-form input').first().fill('segredo@exemplo.com');
  await site.getByTestId('cta-comprar').click();
  await site.waitForURL('**/produto.html');
  await site.waitForTimeout(300);
  const sessionId = await site.evaluate(() => window.abt!.sessionId);
  await site.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await ctx.close();

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=recording&id=${sessionId}`);
  const replay = page.getByTestId('replay').locator('iframe');
  await expect(replay).toHaveCount(1, { timeout: 15_000 });
  // O texto digitado no campo nunca aparece na reprodução (mascarado).
  const frame = page.frameLocator('[data-testid=replay] iframe');
  await expect(frame.locator('body')).toBeVisible();
  expect(await frame.locator('body').innerHTML()).not.toContain('segredo@exemplo.com');
  await expect(page.getByTestId('timeline-list')).toContainText('Página');
  await page.getByTestId('play').click();
  await expect(page.getByTestId('clock')).toBeVisible();
});
