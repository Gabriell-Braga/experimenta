import type { TrackingEvent as AnyEvent, ExperimentEvent as TrackingEvent } from '@abtest/shared';
import { expect, test, type Page } from '@playwright/test';
import { experiment, makeConfig, serveSnippet } from '../helpers';

const COLLECT = 'http://localhost:4000/collect';

function config() {
  return makeConfig(
    [
      experiment(
        [{ id: 'o1', order: 0, type: 'setText', target: { selector: '#hero-title' }, value: 'Corra mais' }],
        {
          segmentation: { urls: [{ match: 'exact', value: 'http://localhost:5180/' }] },
          goals: [
            { id: 'g1', key: 'cta', type: 'click', selector: '[data-testid="cta-comprar"]' },
            { id: 'g2', key: 'obrigado', type: 'pageview', url: { match: 'contains', value: '/obrigado' } },
            { id: 'g3', key: 'signup', type: 'custom', event: 'signup' },
          ],
        },
      ),
    ],
    { trackingUrl: COLLECT },
  );
}

/** Captura os lotes enviados por sendBeacon (text/plain com {events}). */
async function collect(page: Page) {
  const events: TrackingEvent[] = [];
  await page.context().route(COLLECT, async (route) => {
    events.push(...(JSON.parse(route.request().postData() ?? '{}').events ?? []));
    await route.fulfill({ status: 204 });
  });
  return events;
}

test('exposure + conversões (clique, visita a URL em outra página, custom) via sendBeacon', async ({
  page,
}) => {
  await serveSnippet(page, config());
  const events = await collect(page);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
  await page.evaluate(() => (window.abq as { push(c: unknown[]): void }).push(['track', 'signup', 7]));
  await page.getByTestId('cta-comprar').click(); // navega para /produto.html: lote sai no pagehide
  await page.waitForURL('**/produto.html');
  // Playwright não intercepta o beacon do pagehide de um goto; no navegador real ele sai normalmente.
  await page.evaluate(() => window.abt!.flush());
  await page.goto('/obrigado.html');
  await page.evaluate(() => window.abt!.flush());
  await expect
    .poll(() =>
      events
        .filter((e) => e.type === 'exposure' || e.type === 'conversion')
        .map((e) => e.type + (e.type === 'conversion' ? `:${e.goalKey}` : '')),
    )
    .toEqual(['exposure', 'conversion:signup', 'conversion:cta', 'conversion:obrigado']);
  const exp = events.filter((e) => e.type === 'exposure' || e.type === 'conversion');
  const visitor = exp[0]!.visitorId;
  expect(exp.every((e) => e.visitorId === visitor && e.variationKey === 'b' && e.accountId === 'demo')).toBe(
    true,
  );
  expect(exp[1]).toMatchObject({ value: 7 });
  // Coleta de dados: uma página vista por carregamento e o evento customizado, na mesma sessão.
  await page.evaluate(() => window.abt!.flush());
  const all = events as unknown as AnyEvent[];
  await expect
    .poll(() => all.filter((e) => e.type === 'pageview').map((e) => new URL(e.url).pathname))
    .toEqual(['/', '/produto.html', '/obrigado.html']);
  expect(all.find((e) => e.type === 'event')).toMatchObject({ name: 'signup', value: 7 });
  expect(new Set(events.map((e) => e.sessionId)).size).toBe(1);
});

test('fila window.abq criada antes do snippet é processada', async ({ page }) => {
  await serveSnippet(page, config());
  const events = await collect(page);
  await page.addInitScript(() => {
    (window as unknown as { abq: unknown[] }).abq = [['track', 'signup']];
  });
  await page.goto('/');
  await page.evaluate(() => window.abt!.flush());
  await expect.poll(() => events.some((e) => e.type === 'conversion' && e.goalKey === 'signup')).toBe(true);
});

test('modo QA: ?ab_force mostra selo, força a variação e marca eventos como qa', async ({ page }) => {
  await serveSnippet(page, config());
  const events = await collect(page);
  await page.goto('/?ab_force=hero:controle');
  await expect(page.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  const badge = page.locator('[data-abt-qa]');
  await expect(badge).toContainText('Hero → Controle');
  await page.evaluate(() => window.abt!.flush());
  await expect.poll(() => events.length).toBeGreaterThan(0);
  expect(events.every((e) => e.qa === true)).toBe(true);
  // Persiste na sessão ao navegar.
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await expect(badge).toBeVisible();
});

test('bots não entram em experimentos', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  const page = await ctx.newPage();
  await serveSnippet(page, config());
  await page.goto('http://localhost:5180/');
  await expect(page.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  expect(await page.evaluate(() => window.abt)).toBeUndefined();
  await ctx.close();
});

test('mapa de calor: cliques com posição relativa e profundidade de scroll ao sair', async ({ page }) => {
  await serveSnippet(page, { ...config(), heatmap: { sampleRate: 1 } });
  const events = (await collect(page)) as unknown as {
    type: string;
    selector?: string;
    rx?: number;
    depth?: number;
    variations?: object;
  }[];
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.goto('/');
  const box = (await page.locator('.hero-subtitle').boundingBox())!;
  await page.locator('.hero-subtitle').click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(100);
  // Saída da página: o Playwright não intercepta beacons disparados durante o unload real, então simulamos o pagehide.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => events.filter((e) => e.type === 'scroll').length).toBeGreaterThan(0);
  const click = events.find((e) => e.type === 'click')!;
  expect(click.selector).toBe('#hero > p');
  expect(click.rx).toBeCloseTo(0.5, 1);
  expect(click.variations).toEqual({ e1: 'v1' });
  const scroll = events.find((e) => e.type === 'scroll')!;
  expect(scroll.depth).toBeGreaterThan(40);
});
