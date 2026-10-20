import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('recomendações: vitrine "quem viu também viu" aparece na loja depois do produto visto', async ({
  page,
  browser,
  request,
}) => {
  // Histórico de outros visitantes: quem viu o 1 também viu o 6 e o 7.
  const n = Math.random().toString(36).slice(2, 7);
  const pv = (v: string, id: number, i: number) => ({
    eventId: `${n}-${v}-${id}-${i}`,
    ts: Date.now() - 60_000 + i,
    accountId: 'demo',
    visitorId: `${n}-${v}`,
    url: 'http://localhost:5180/loja/',
    type: 'event',
    name: 'product_view',
    props: {
      id: String(id),
      name: `Produto ${id}`,
      price: id * 50,
      category: 'corrida',
      url: `/loja/#produto-${id}`,
    },
  });
  const events = ['a', 'b', 'c'].flatMap((v, k) => [
    pv(v, 1, k * 3),
    pv(v, 6, k * 3 + 1),
    pv(v, 7, k * 3 + 2),
  ]);
  await request.post('http://localhost:4000/collect', { data: JSON.stringify({ events }) });

  await login(page);
  await nav(page, 'recos');
  await page.getByTestId('new-reco').click();
  const name = `Vitrine ${n}`;
  await page.getByTestId('reco-name').fill(name);
  await page.getByTestId('reco-selector').fill('#produtos');
  await page.getByTestId('reco-publish').click();
  await expect(page.getByTestId('reco-row').filter({ hasText: name })).toBeVisible();

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto('http://localhost:5180/loja/');
  await v.locator('[data-quick="1"]').click(); // produto 1 visto
  await v.reload();
  const shelf = v.locator('#produtos + abt-reco');
  await expect(shelf.locator('a[data-product]').first()).toBeVisible({ timeout: 15_000 });
  await expect(shelf.locator('a[data-product="1"]')).toHaveCount(0); // nunca o próprio produto
  await ctx.close();

  await page
    .getByTestId('reco-row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Pausar' })
    .click();
});
