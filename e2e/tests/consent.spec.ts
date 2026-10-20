import { expect, test, type Page } from '@playwright/test';
import { experiment, makeConfig, serveSnippet } from '../helpers';

const COLLECT = 'http://localhost:4000/collect';

const config = (consent?: { cmp?: 'onetrust' | 'cookiebot' | 'gcm' }) =>
  makeConfig(
    [
      experiment([
        { id: 'o1', order: 0, type: 'setText', target: { selector: '#hero-title' }, value: 'Corra mais' },
      ]),
    ],
    { trackingUrl: COLLECT, ...(consent ? { consent } : {}) },
  );

/** Quantidade de eventos recebidos pelo /collect. */
async function collect(page: Page) {
  const got = { events: 0 };
  await page.context().route(COLLECT, async (route) => {
    got.events += (JSON.parse(route.request().postData() ?? '{}').events ?? []).length;
    await route.fulfill({ status: 204 });
  });
  return got;
}

const abtCookies = async (page: Page) =>
  (await page.context().cookies()).filter((c) => c.name.startsWith('_abt')).map((c) => c.name);
const push = (page: Page, cmd: unknown[]) =>
  page.evaluate((c) => (window.abq as { push(c: unknown[]): void }).push(c), cmd);

test('esperar consentimento: nada roda nem grava até aceitar; aceite vale nas próximas páginas', async ({
  page,
}) => {
  await serveSnippet(page, config({}));
  const got = await collect(page);
  await page.goto('/');
  await expect(page.locator('#hero-title')).not.toHaveText('Corra mais');
  expect(await abtCookies(page)).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('_abt')))).toEqual(
    [],
  );
  expect(await page.evaluate(() => window.abt)).toBeUndefined();

  await push(page, ['consent', true]);
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
  expect(await abtCookies(page)).toEqual(expect.arrayContaining(['_abt_c', '_abt_vid', '_abt_sid']));
  await page.evaluate(() => window.abt!.flush());
  await expect.poll(() => got.events).toBeGreaterThan(0);

  // Próxima página: liga na hora, sem esperar de novo.
  await page.reload();
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
});

test('opt-out do visitante: desliga, apaga cookies e storage e não volta nas próximas páginas', async ({
  page,
}) => {
  await serveSnippet(page, config());
  const got = await collect(page);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
  await page.evaluate(() => window.abt!.flush());
  await expect.poll(() => got.events).toBeGreaterThan(0);

  await push(page, ['consent', false]);
  expect(await abtCookies(page)).toEqual(['_abt_c']);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('_abt')))).toEqual(
    [],
  );
  const before = got.events;
  await push(page, ['track', 'depois']);
  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect(page.locator('#hero-title')).not.toHaveText('Corra mais');
  expect(await abtCookies(page)).toEqual(['_abt_c']);
  expect(got.events).toBe(before);
});

test('Cookiebot: liga quando o banner registra o aceite', async ({ page }) => {
  await serveSnippet(page, config({ cmp: 'cookiebot' }));
  await page.goto('/');
  await expect(page.locator('#hero-title')).not.toHaveText('Corra mais');
  await page.evaluate(() => {
    (window as unknown as { Cookiebot: object }).Cookiebot = {
      hasResponse: true,
      consent: { statistics: true },
    };
    window.dispatchEvent(new Event('CookiebotOnConsentReady'));
  });
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
});
