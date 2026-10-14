import { expect, test, type FrameLocator, type Page } from '@playwright/test';

/**
 * Fluxo da tarefa 3.8: no editor real, uma variação com texto, cor, elemento escondido, elemento movido
 * e CSS custom — aplicada ao vivo e reaplicada depois de salvar e recarregar.
 */

async function assertVariation(site: FrameLocator) {
  await expect(site.locator('#hero-title')).toHaveText('Corra 2x mais rápido');
  await expect(site.locator('[data-testid=cta-comprar]')).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(site.locator('.features h2')).toBeHidden();
  const order = await site.locator('#hero > *').evaluateAll((els) => els.map((e) => e.tagName.toLowerCase()));
  expect(order).toEqual(['h1', 'a', 'img', 'p']); // subtítulo movido para depois da imagem
  await expect(site.locator('.site-footer')).toHaveCSS('background-color', 'rgb(254, 243, 199)');
}

async function connected(page: Page) {
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
}

test('editor: criar variação completa, ver ao vivo, salvar, recarregar e ver reaplicada', async ({
  page,
}) => {
  await page.goto('http://localhost:5173/');
  await connected(page);
  const site = page.frameLocator('[data-testid=site-frame]');
  const overlay = site.locator('abt-editor-overlay');

  // 1) Texto: edição inline.
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Corra 2x mais rápido');
  await page.keyboard.press('Enter');

  // 2) Cor: painel de propriedades.
  await site.locator('[data-testid=cta-comprar]').click();
  await expect(page.getByTestId('selected-selector')).toHaveText('[data-testid="cta-comprar"]');
  await page.getByTestId('prop-background').fill('#dc2626');
  await page.getByTestId('prop-background').press('Enter');
  await expect(site.locator('[data-testid=cta-comprar]')).toHaveCSS('background-color', 'rgb(220, 38, 38)');

  // 3) Esconder: menu de contexto.
  await site.locator('.features h2').click({ button: 'right' });
  await overlay.locator('[data-action=hide]').click();

  // 4) Mover: arrastar o subtítulo para depois da imagem.
  await site.locator('.hero-subtitle').click();
  const h = (await overlay.locator('.handle').boundingBox())!;
  const img = (await site.locator('.hero-img').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width / 2, img.y + img.height - 4, { steps: 10 });
  await page.mouse.up();

  // 5) CSS custom: Monaco.
  await page.getByTestId('side-code').click();
  await page.getByTestId('code-css').locator('.monaco-editor textarea').focus();
  await page.keyboard.insertText('.site-footer { background: #fef3c7; }');

  // Ao vivo.
  await assertVariation(site);
  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('change')).toHaveCount(4); // + CSS custom fora da lista
  await expect(page.getByTestId('change').and(page.locator('[data-status=failed]'))).toHaveCount(0);

  // Controle continua original.
  await page.getByTestId('tab-controle').click();
  await expect(site.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await expect(site.locator('.features h2')).toBeVisible();
  await page.getByTestId('tab-variacao-1').click();
  await assertVariation(site);

  // Salvar e recarregar o editor: tudo reaplicado.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo');
  await page.reload();
  await connected(page);
  await assertVariation(site);

  // Recarregar só a página do site (navegar) também reaplica.
  await page.getByTestId('mode-browse').click();
  await site.locator('a.logo').click();
  await connected(page);
  await assertVariation(site);
});
