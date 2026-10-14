import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

test('barra superior: edição pelo site, abas, desfazer/refazer, dispositivo, salvar e recarregar', async ({
  page,
}) => {
  const site = await openEditor(page);
  const title = site.locator('#hero-title');

  await title.dblclick();
  await page.keyboard.type('Corra mais');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-variacao-1')).toContainText('(1)');
  await expect(title).toHaveText('Corra mais');

  // Controle não tem a alteração; voltar para a variação reaplica.
  await page.getByTestId('tab-controle').click();
  await expect(title).toHaveText('O melhor tênis para correr');
  await page.getByTestId('tab-variacao-1').click();
  await expect(title).toHaveText('Corra mais');

  await page.getByTestId('undo').click();
  await expect(title).toHaveText('O melhor tênis para correr');
  await page.getByTestId('redo').click();
  await expect(title).toHaveText('Corra mais');

  // Troca de dispositivo muda a largura do iframe.
  await page.getByTestId('device-mobile').click();
  await expect.poll(async () => (await page.getByTestId('site-frame').boundingBox())!.width).toBe(390);
  await page.getByTestId('device-desktop').click();

  await page.getByTestId('add-variation').click();
  await expect(page.getByTestId('tab-variacao-2')).toHaveAttribute('aria-selected', 'true');
  await expect(title).toHaveText('O melhor tênis para correr');

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo');
  await page.reload();
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  await expect(page.getByTestId('tab-variacao-1')).toContainText('(1)');
  await expect(page.getByTestId('tab-variacao-2')).toBeVisible();
});

test('modos: navegar deixa o site navegar e mantém a variação; preview esconde o painel', async ({
  page,
}) => {
  const site = await openEditor(page);
  await site.locator('#hero-title').dblclick();
  await page.keyboard.type('Título B');
  await page.keyboard.press('Enter');
  await expect(site.locator('#hero-title')).toHaveText('Título B');

  // Editar: clique em link não navega.
  await site.locator('[data-testid=cta-comprar]').click();
  await expect(site.locator('#hero-title')).toBeVisible();

  await page.getByTestId('mode-browse').click();
  await site.locator('[data-testid=cta-comprar]').click();
  await expect(site.locator('.product-title')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  await site.locator('a.logo').click();
  await expect(site.locator('#hero-title')).toHaveText('Título B'); // agent reconectou e reaplicou

  await page.getByTestId('mode-preview').click();
  await expect(page.getByTestId('preview-banner')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeHidden();
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
});

test('prompt do agent abre diálogo no app (inserir HTML)', async ({ page }) => {
  const site = await openEditor(page);
  await site.locator('#hero-title').click({ button: 'right' });
  await site.locator('abt-editor-overlay').locator('[data-action=insert-after]').click();
  await page.getByTestId('prompt-input').fill('<p class="selo">Frete grátis hoje</p>');
  await page.getByTestId('prompt-ok').click();
  await expect(site.locator('.selo')).toHaveText('Frete grátis hoje');
});
