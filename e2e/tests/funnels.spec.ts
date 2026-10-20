import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('funil: cria pelo construtor e vê passos com conversão', async ({ page, request }) => {
  const v = `fn-${Math.random().toString(36).slice(2, 8)}`;
  const base = { accountId: 'demo', visitorId: v, sessionId: v, device: 'desktop' };
  await request.post('http://localhost:4000/collect', {
    data: JSON.stringify({
      events: [
        { ...base, eventId: `${v}1`, ts: Date.now() - 2000, type: 'pageview', url: 'http://localhost:5180/' },
        {
          ...base,
          eventId: `${v}2`,
          ts: Date.now() - 1000,
          type: 'pageview',
          url: 'http://localhost:5180/produto.html',
        },
      ],
    }),
  });
  await login(page);
  await nav(page, 'funnels');
  await page.getByTestId('new-funnel').click();
  const name = `Funil ${v}`;
  await page.getByTestId('funnel-name').fill(name);
  const values = page.getByTestId('funnel-step-value');
  await values.nth(0).fill('localhost:5180/');
  await values.nth(1).fill('/produto');
  await page.getByTestId('funnel-save').click();
  await expect(page.getByTestId('funnel-item').filter({ hasText: name })).toBeVisible();
  await page.getByTestId('funnel-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('funnel-steps').locator(':scope > li')).toHaveCount(2);
  await expect(page.getByTestId('funnel-conversion')).toContainText('%');
});
