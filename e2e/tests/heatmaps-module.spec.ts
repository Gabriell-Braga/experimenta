import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

const API = 'http://localhost:4000';

test('módulo Mapas de calor: lista de páginas e visualizador sobre o site real (também para viewer)', async ({
  page,
  request,
}) => {
  const vid = `hm-${Math.random().toString(36).slice(2, 8)}`;
  const base = {
    ts: Date.now(),
    accountId: 'demo',
    visitorId: vid,
    sessionId: vid,
    url: 'http://localhost:5180/produto.html',
  };
  await request.post(`${API}/collect`, {
    data: JSON.stringify({
      events: [
        { ...base, eventId: `${vid}-1`, type: 'pageview', device: 'desktop', title: 'Produto' },
        {
          ...base,
          eventId: `${vid}-2`,
          type: 'frustration',
          device: 'desktop',
          variations: {},
          kind: 'dead',
          selector: 'h1',
          rx: 0.5,
          ry: 0.5,
          count: 1,
        },
      ],
    }),
  });
  await login(page, { email: 'viewer@abtest.dev', password: 'demo1234' });
  await nav(page, 'heatmaps');
  await page.getByTestId('page-row').filter({ hasText: '5180/produto' }).click();
  await expect(page.getByTestId('viewer-url')).toHaveText('localhost:5180/produto.html');
  await page.getByTestId('heatmap-mode-frustration').click();
  const overlay = page.frameLocator('[data-testid=site-frame]').locator('abt-editor-overlay');
  await expect(overlay.locator('.heat-badge.fr[data-selector="h1"]')).toContainText('dead');
});
