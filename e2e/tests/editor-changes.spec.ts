import { expect, test, type Page } from '@playwright/test';
import { openEditor } from '../editor';

async function editText(page: Page, site: ReturnType<Page['frameLocator']>, selector: string, text: string) {
  await site.locator(selector).dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('lista de alterações: descrever, destacar, reordenar e excluir', async ({ page }) => {
  const site = await openEditor(page);
  await editText(page, site, '#hero-title', 'Primeiro');
  await editText(page, site, '#hero-title', 'Segundo'); // cada edição inline gera uma operação
  await site.locator('.features h2').click({ button: 'right' });
  await site.locator('abt-editor-overlay').locator('[data-action=hide]').click();

  await page.getByTestId('side-changes').click();
  const items = page.getByTestId('change');
  await expect(items).toHaveCount(3);
  await expect(page.getByTestId('change-desc')).toHaveText([
    'Texto → “Primeiro”',
    'Texto → “Segundo”',
    'Esconder',
  ]);
  await expect(site.locator('#hero-title')).toHaveText('Segundo'); // aplicadas em ordem

  // Passar o mouse destaca o elemento no site.
  await items.nth(0).hover();
  await expect(site.locator('abt-editor-overlay').locator('.hover-label')).toHaveText('h1#hero-title');

  // Reordenar: "Segundo" sobe → agora "Primeiro" é aplicado por último.
  await items.nth(1).getByRole('button', { name: 'Subir' }).click();
  await expect(page.getByTestId('change-desc').first()).toHaveText('Texto → “Segundo”');
  await expect(site.locator('#hero-title')).toHaveText('Primeiro');

  // Excluir o "esconder" → h2 volta.
  await expect(site.locator('.features h2')).toBeHidden();
  await items.nth(2).getByTestId('change-remove').click();
  await expect(items).toHaveCount(2);
  await expect(site.locator('.features h2')).toBeVisible();
});

test('alteração cujo elemento não existe na página fica marcada em vermelho', async ({ page }) => {
  const site = await openEditor(page);
  await site.locator('.promo-banner').click(); // aparece 800 ms após o load
  await page.getByTestId('prop-text').fill('Oferta da variação');
  await page.getByTestId('prop-text').blur();
  await expect(site.locator('.promo-banner')).toHaveText('Oferta da variação');
  // Em outra página (produto) o banner não existe.
  await page.getByTestId('mode-browse').click();
  await site.locator('[data-testid=cta-comprar]').click();
  await expect(site.locator('.product-title')).toBeVisible();
  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('change')).toHaveAttribute('data-status', 'failed', { timeout: 5000 });
  await expect(
    page.getByTestId('side-changes').getByTitle('Alterações que não encontraram o elemento'),
  ).toHaveText('1');
});

test('CSS e JS custom com Monaco: CSS aplica ao vivo; JS só roda quando habilitado', async ({ page }) => {
  const site = await openEditor(page);
  await page.getByTestId('side-code').click();
  const cssEditor = page.getByTestId('code-css').locator('.monaco-editor textarea');
  await cssEditor.focus();
  await page.keyboard.insertText('.hero { background: rgb(0, 128, 0); }');
  await expect(site.locator('.hero')).toHaveCSS('background-color', 'rgb(0, 128, 0)');

  const jsEditor = page.getByTestId('code-js').locator('.monaco-editor textarea');
  await jsEditor.focus();
  await page.keyboard.insertText("document.body.dataset.variacao = 'b';");
  await page.waitForTimeout(300);
  await expect(site.locator('body')).not.toHaveAttribute('data-variacao', 'b');
  await page.getByTestId('run-js').check();
  await expect(site.locator('body')).toHaveAttribute('data-variacao', 'b');

  // CSS persiste após salvar e recarregar.
  await page.getByTestId('save').click();
  await page.reload();
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  await expect(site.locator('.hero')).toHaveCSS('background-color', 'rgb(0, 128, 0)');
});
