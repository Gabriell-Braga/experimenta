import { expect, test } from '@playwright/test';
import { openAgentHost, waitEvent } from '../host';

interface Info {
  tag: string;
  target: { selector: string };
  fragility: string;
  breadcrumb: { label: string }[];
  styles: Record<string, string>;
}

test('agent no site real: hover com contorno e label, clique seleciona sem navegar, breadcrumb', async ({
  page,
}) => {
  const host = await openAgentHost(page);
  const overlay = host.frame.locator('abt-editor-overlay');

  await host.frame.locator('[data-testid=cta-comprar]').hover();
  await expect(overlay.locator('.hover-label')).toHaveText('a.btn.btn-primary');
  await expect(overlay.locator('.box.hover')).toBeVisible();

  // Clique no link NÃO navega no modo edição.
  await host.frame.locator('[data-testid=cta-comprar]').click();
  await waitEvent(page, 'selected');
  const [info] = (await host.events<Info>('selected')).slice(-1);
  expect(info!.tag).toBe('a');
  expect(info!.target.selector).toBe('[data-testid="cta-comprar"]');
  expect(info!.fragility).toBe('low');
  expect(info!.styles['background-color']).toBe('rgb(37, 99, 235)');
  expect(info!.breadcrumb.map((b) => b.label)).toEqual(['section#hero.hero', 'main', 'body']);
  await expect(host.frame.locator('#hero-title')).toBeVisible(); // continua na mesma página

  // O CSS do site não vaza para o overlay (Shadow DOM) e o contorno de seleção acompanha o elemento.
  const box = await overlay.locator('.box.sel').boundingBox();
  const el = await host.frame.locator('[data-testid=cta-comprar]').boundingBox();
  expect(Math.round(box!.x)).toBe(Math.round(el!.x));
  expect(Math.round(box!.width)).toBe(Math.round(el!.width));

  // Breadcrumb: seleciona o ancestral <section>.
  await overlay.locator('.crumbs button', { hasText: 'section#hero.hero' }).click();
  await waitEvent(page, 'selected', 2);
  expect(((await host.events<Info>('selected')).at(-1) as Info).tag).toBe('section');

  // Elemento com classes CSS-in-JS/ids gerados: indicador de fragilidade.
  await host.frame.locator('.pricing .plan-featured .price').click();
  await waitEvent(page, 'selected', 3);
  const price = (await host.events<Info>('selected')).at(-1) as Info;
  expect(price.target.selector).toBe('div.plan-featured p.price');
  expect(price.target.selector).not.toContain('a8f3c91e');
});

test('modo navegar deixa o clique navegar; agent volta após a navegação', async ({ page }) => {
  const host = await openAgentHost(page);
  await host.call('setMode', { mode: 'browse' });
  await host.frame.locator('[data-testid=cta-comprar]').click();
  await waitEvent(page, 'ready', 2); // nova página → snippet refaz o handshake → agent emite ready de novo
  const ready = (await host.events<{ url: string }>('ready')).at(-1)!;
  expect(ready.url).toContain('/produto.html');
  await expect(host.frame.locator('.product-title')).toBeVisible();
});
