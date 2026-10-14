import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openEditor } from '../editor';

const EXT = fileURLToPath(new URL('../../apps/extension/dist', import.meta.url));
const BLOCKED_WITH = 'http://localhost:5180/bloqueado/com-snippet.html';
const BLOCKED_WITHOUT = 'http://localhost:5180/bloqueado/sem-snippet.html';

async function openUrl(page: Page, url: string) {
  const input = page.getByLabel('URL da página');
  await input.fill(url);
  await input.press('Enter');
}

let ctx: BrowserContext;
test.describe('com a extensão instalada', () => {
  test.beforeAll(async () => {
    ctx = await chromium.launchPersistentContext('', {
      channel: 'chromium', // headless novo: suporta extensões
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--disable-features=LocalNetworkAccessChecks',
      ],
    });
  });
  test.afterAll(() => ctx.close());

  test('site que bloqueia iframe (com snippet): fallback automático pela extensão, edição funciona', async () => {
    const page = await ctx.newPage();
    const site = await openEditor(page);
    await openUrl(page, BLOCKED_WITH);
    await expect(page.getByTestId('ext-active')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
    await site.locator('#bloq-title').dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Editado via extensão');
    await page.keyboard.press('Enter');
    await expect(site.locator('#bloq-title')).toHaveText('Editado via extensão');
    await page.close();
  });

  test('site sem snippet: a extensão injeta o script da conta e o agent conecta', async () => {
    const page = await ctx.newPage();
    const site = await openEditor(page);
    await openUrl(page, BLOCKED_WITHOUT);
    await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true', { timeout: 15000 });
    await expect(site.locator('script[data-abt-injected=extension]')).toHaveCount(1);
    await site.locator('#bloq-title').click();
    await expect(page.getByTestId('selected-selector')).toHaveText('#bloq-title');
    await page.close();
  });

  test('outra aba sem sessão de edição continua bloqueada', async () => {
    // Abre uma sessão numa aba (regras valem só nela)...
    const editor = await ctx.newPage();
    await openEditor(editor);
    await openUrl(editor, BLOCKED_WITH);
    await expect(editor.getByTestId('ext-active')).toBeVisible({ timeout: 15000 });
    // ...e outra aba tenta emoldurar a mesma página.
    const other = await ctx.newPage();
    await other.route('http://localhost:5174/frame', (r) =>
      r.fulfill({ contentType: 'text/html', body: `<iframe id="f" src="${BLOCKED_WITH}"></iframe>` }),
    );
    await other.goto('http://localhost:5174/frame');
    await other.waitForTimeout(1500);
    const child = other.frames().find((f) => f !== other.mainFrame())!;
    expect(await child.locator('#bloq-title').count()).toBe(0);
    await editor.close();
    await other.close();
  });
});

test('sem a extensão: o editor avisa que o site bloqueia iframe', async ({ page }) => {
  await openEditor(page);
  await openUrl(page, BLOCKED_WITH);
  await expect(page.getByTestId('ext-missing')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'false');
});
