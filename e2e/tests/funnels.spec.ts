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

test('trocar de funil: mostra esqueleto, nunca o relatório do funil anterior', async ({ page, request }) => {
  const { token } = (await (
    await request.post('http://localhost:4000/auth/login', {
      headers: { origin: 'http://localhost:5173' },
      data: { email: 'demo@abtest.dev', password: 'demo1234' },
    })
  ).json()) as { token: string };
  const id = Math.random().toString(36).slice(2, 7);
  const create = async (name: string, steps: string[]) =>
    (
      (await (
        await request.post('http://localhost:4000/entities/funnel', {
          headers: { origin: 'http://localhost:5173', authorization: `Bearer ${token}` },
          data: {
            name,
            data: {
              steps: steps.map((s) => ({ type: 'url', name: s, url: { match: 'contains', value: s } })),
            },
          },
        })
      ).json()) as { id: string }
    ).id;
  await create(`Dois passos ${id}`, ['/a', '/b']);
  const slow = await create(`Três passos ${id}`, ['/a', '/b', '/c']);
  // Relatório do segundo funil demora: é a janela em que o dado velho aparecia.
  await page.route(`http://localhost:4000/analytics/funnel/${slow}*`, async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.continue();
  });
  await login(page);
  await nav(page, 'funnels');
  await page
    .getByTestId('funnel-item')
    .filter({ hasText: `Dois passos ${id}` })
    .click();
  await expect(page.getByTestId('funnel-steps').locator(':scope > li')).toHaveCount(2);
  await page
    .getByTestId('funnel-item')
    .filter({ hasText: `Três passos ${id}` })
    .click();
  await expect(page.getByTestId('loading')).toBeVisible();
  await expect(page.getByTestId('funnel-steps')).toHaveCount(0);
  await expect(page.getByTestId('funnel-steps').locator(':scope > li')).toHaveCount(3);
});
