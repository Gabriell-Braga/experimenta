import { compileFunnel, ExperimentSchema } from '@abtest/shared';
import { expect, test, type Page } from '@playwright/test';
import { openEditor } from '../editor';
import { makeConfig, serveSnippet } from '../helpers';

const DEMO = 'http://localhost:5180';

// Teste multipágina / funil (17.2).
test('visitante passa por duas páginas do funil na mesma variação, cada uma com as alterações dela', async ({
  page,
}) => {
  const op = (id: string, selector: string, value: string, pg: string) => ({
    id,
    order: 0,
    type: 'setText',
    target: { selector },
    value,
    page: pg,
  });
  const exp = ExperimentSchema.parse({
    id: 'e_funil',
    key: 'funil',
    name: 'Funil',
    status: 'running',
    pages: [
      { id: 'p1', name: 'Home', url: `${DEMO}/`, match: { match: 'exact', value: `${DEMO}/` } },
      {
        id: 'p2',
        name: 'Produto',
        url: `${DEMO}/produto.html`,
        match: { match: 'contains', value: '/produto' },
      },
    ],
    // 50/50: o que a 1ª página sorteia precisa valer na 2ª.
    variations: ['a', 'b'].map((k) => ({
      id: `v_${k}`,
      key: k,
      name: k.toUpperCase(),
      weight: 50,
      operations: [
        op(`${k}1`, '#hero-title', `Home ${k}`, 'p1'),
        op(`${k}2`, '.product-title', `Produto ${k}`, 'p2'),
      ],
    })),
  });
  await serveSnippet(page, makeConfig([compileFunnel(exp)]));

  for (let i = 0; i < 3; i++) {
    await page.context().clearCookies();
    await page.goto(`${DEMO}/`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const key = await page.evaluate(() => window.abt!.assignments().funil);
    expect(['a', 'b']).toContain(key);
    await expect(page.locator('#hero-title')).toHaveText(`Home ${key}`);
    await page.getByTestId('cta-comprar').click();
    await expect(page.locator('.product-title')).toHaveText(`Produto ${key}`);
    expect(await page.evaluate(() => window.abt!.assignments().funil)).toBe(key);
  }
});

async function editText(page: Page, site: ReturnType<Page['frameLocator']>, selector: string, text: string) {
  await site.locator(selector).dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('editor: transforma em multipágina, navega entre as páginas e edita cada uma', async ({ page }) => {
  const site = await openEditor(page);
  await editText(page, site, '#hero-title', 'Home B');

  await page.getByTestId('open-settings').click();
  await page.getByTestId('make-funnel').click();
  await expect(page.getByTestId('funnel-page-settings')).toHaveCount(1);
  await page.getByTestId('settings-done').click();
  const pages = page.getByTestId('funnel-page');
  await expect(pages).toHaveText(['1. Página 1(1)']);

  // Fora do funil: só navegar, até adicionar a página.
  await page.getByTestId('mode-browse').click();
  await site.locator('[data-testid=cta-comprar]').click();
  await expect(site.locator('.product-title')).toBeVisible();
  await expect(page.getByTestId('funnel-add')).toBeVisible();
  await page.getByTestId('funnel-add').click();
  await expect(pages).toHaveText(['1. Página 1(1)', '2. Página 2(0)']);
  await expect(pages.nth(1)).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('mode-edit').click();
  await editText(page, site, '.product-title', 'Produto B');
  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('change-desc')).toHaveText(['Texto → “Produto B”']);

  // Voltar à página 1 pelo funil: a lista e o site mostram só as alterações dela.
  await pages.nth(0).click();
  await expect(site.locator('#hero-title')).toHaveText('Home B');
  await expect(page.getByTestId('change-desc')).toHaveText(['Texto → “Home B”']);

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-state')).toContainText(/Salvo/i);
  await page.reload();
  await expect(page.getByTestId('funnel-page')).toHaveText(['1. Página 1(1)', '2. Página 2(1)']);
});
