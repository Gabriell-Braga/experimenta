import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { openEditor } from '../editor';

const LOJA = 'http://localhost:5180/loja/';

async function openUrl(page: Page, url: string) {
  const input = page.getByLabel('URL da página');
  await input.fill(url);
  await input.press('Enter');
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
}

async function editText(page: Page, site: FrameLocator, selector: string, text: string) {
  await site.locator(selector).dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/**
 * Site "complexo": conteúdo carregado depois (grade de produtos via JS), re-render ao trocar de aba,
 * carrossel, contagem regressiva mexendo no DOM a cada segundo e classes geradas misturadas com BEM.
 */
test('loja completa: editar conteúdo dinâmico, sobreviver a re-render e publicar para visitante', async ({
  page,
  browser,
}) => {
  const site = await openEditor(page);
  await openUrl(page, LOJA);
  // Segmentação padrão (só a página inicial) acompanha a página aberta: sem alerta.
  await expect(page.getByTestId('segment-warning')).toHaveCount(0);

  // Título do carrossel e card de produto renderizado ~700 ms depois do load.
  await editText(page, site, '#hero-headline', 'Seu melhor tempo começa aqui');
  const card = site.locator('[data-product-id="1"] .product-card__title');
  await expect(card).toHaveText('Runner X Nuvem 2');
  // Centraliza e clica no ponto, como o usuário: a checagem de "obstrução" do Playwright se confunde com o
  // cabeçalho fixo do site + o card que sobe 2 px no hover.
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('selected-selector')).toContainText('[data-product-id="1"]'); // âncora estável, não a classe gerada
  await expect(page.getByTestId('fragility')).not.toHaveText('frágil');
  await page.getByTestId('prop-text').fill('Runner X — edição limitada');
  await page.getByTestId('prop-text').blur();
  await expect(card).toHaveText('Runner X — edição limitada');

  // Re-render da grade (aba Corrida → Todos): a alteração volta sozinha nos nós novos.
  await page.getByTestId('mode-browse').click();
  await site.locator('[data-cat="corrida"]').click();
  await site.locator('[data-cat="todos"]').click();
  await expect(card).toHaveText('Runner X — edição limitada');
  // A contagem regressiva continua andando e não quebra a conexão.
  const t1 = await site.locator('#countdown').textContent();
  await page.waitForTimeout(1100);
  expect(await site.locator('#countdown').textContent()).not.toBe(t1);
  await page.getByTestId('mode-edit').click();

  // Publicar 100% na variação.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('running');
  await page.getByTestId('settings-step-variation').click();
  await page.getByTestId('weight-controle').fill('0');
  await page.getByTestId('weight-controle').blur();
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('Publicado (versão');

  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(LOJA);
  await expect(vp.locator('#hero-headline')).toHaveText('Seu melhor tempo começa aqui');
  await expect(vp.locator('[data-product-id="1"] .product-card__title')).toHaveText(
    'Runner X — edição limitada',
  );
  await vp.locator('[data-cat="corrida"]').click();
  await expect(vp.locator('[data-product-id="1"] .product-card__title')).toHaveText(
    'Runner X — edição limitada',
  );
  await visitor.close();

  // Não deixa o experimento valendo para os outros testes.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('archived');
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('não entra na publicação');
});
