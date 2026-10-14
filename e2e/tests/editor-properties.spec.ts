import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

test('painel de propriedades: texto, cores, tipografia, borda e atributos viram operações aplicadas ao vivo', async ({
  page,
}) => {
  const site = await openEditor(page);
  const cta = site.locator('[data-testid=cta-comprar]');

  await cta.click();
  await expect(page.getByTestId('selected-selector')).toHaveText('[data-testid="cta-comprar"]');
  await expect(page.getByTestId('fragility')).toHaveText('estável');
  await expect(page.getByTestId('prop-background')).toHaveValue('rgb(37, 99, 235)');

  const commit = async (testId: string, value: string) => {
    await page.getByTestId(testId).fill(value);
    await page.getByTestId(testId).press('Enter');
  };
  await commit('prop-text', 'Quero o meu');
  await page.getByTestId('prop-text').blur();
  await commit('prop-background', '#ff0000');
  await commit('prop-font-size', '22px');
  await commit('prop-radius', '20px');
  await commit('attr-href', '/obrigado.html');

  await expect(cta).toHaveText('Quero o meu');
  await expect(cta).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await expect(cta).toHaveCSS('font-size', '22px');
  await expect(cta).toHaveCSS('border-top-left-radius', '20px');
  await expect(cta).toHaveAttribute('href', '/obrigado.html');

  // Estilos se juntam numa só operação: texto + estilo + atributo = 3.
  await expect(page.getByTestId('tab-variacao-1')).toContainText('(3)');

  // Breadcrumb do painel seleciona o ancestral.
  await page.getByTestId('properties').getByRole('button', { name: 'section#hero.hero' }).click();
  await expect(page.getByTestId('selected-selector')).toHaveText('#hero');

  // Elemento com id gerado: seletor frágil/médio indicado.
  await site.locator('.feature-list li').nth(1).click();
  await expect(page.getByTestId('fragility')).toHaveText('frágil');
});
