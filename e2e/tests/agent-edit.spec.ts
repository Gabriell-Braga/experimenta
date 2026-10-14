import { expect, test } from '@playwright/test';
import { openAgentHost, waitEvent } from '../host';

interface Draft {
  type: string;
  target: { selector: string };
  value?: unknown;
}
const lastDraft = async (host: Awaited<ReturnType<typeof openAgentHost>>) =>
  ((await host.events<{ draft: Draft }>('operation')).at(-1) as { draft: Draft }).draft;

test('edição inline: duplo clique, digitar, Enter → setText; aplicar a variação mostra o texto', async ({
  page,
}) => {
  const host = await openAgentHost(page);
  const title = host.frame.locator('#hero-title');
  await title.dblclick();
  await expect(title).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type('Corra mais longe');
  await page.keyboard.press('Enter');
  await waitEvent(page, 'operation');
  const d = await lastDraft(host);
  expect(d).toMatchObject({
    type: 'setText',
    target: { selector: '#hero-title' },
    value: 'Corra mais longe',
  });
  await expect(title).toHaveText('O melhor tênis para correr'); // agent não muda o DOM sozinho
  await host.call('applyVariation', { operations: [{ ...d, id: 'o1', order: 0 }] });
  await expect(title).toHaveText('Corra mais longe');
});

test('arrastar para mover: alça do selecionado → solta abaixo de outro elemento → move', async ({ page }) => {
  const host = await openAgentHost(page);
  await host.frame.locator('.hero-subtitle').click();
  const handle = host.frame.locator('abt-editor-overlay').locator('.handle');
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  const img = (await host.frame.locator('.hero-img').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width / 2, img.y + img.height - 5, { steps: 8 });
  await expect(host.frame.locator('abt-editor-overlay').locator('.drop')).toHaveAttribute(
    'data-position',
    'after',
  );
  await page.mouse.up();
  await waitEvent(page, 'operation');
  const d = await lastDraft(host);
  expect(d).toMatchObject({
    type: 'move',
    target: { selector: 'p.hero-subtitle' },
    value: { position: 'after', anchor: { selector: 'img[alt="Tênis azul"]' } },
  });
  await host.call('applyVariation', { operations: [{ ...d, id: 'o1', order: 0 }] });
  const order = await host.frame
    .locator('#hero > *')
    .evaluateAll((els) => els.map((e) => e.className || e.id));
  expect(order).toEqual(['hero-title', 'btn btn-primary', 'hero-img', 'hero-subtitle']);
});

test('menu de contexto: trocar imagem pede URL ao app; esconder; copiar seletor', async ({ page }) => {
  const host = await openAgentHost(page);
  await host.reply({ image: '/tenis-vermelho.svg', html: '<p class="selo">Novo!</p>' });
  const menu = host.frame.locator('abt-editor-overlay').locator('.menu');

  await host.frame.locator('.hero-img').click({ button: 'right' });
  await menu.locator('[data-action=image]').click();
  await waitEvent(page, 'operation');
  const img = await lastDraft(host);
  expect(img).toMatchObject({ type: 'replaceImage', value: { src: '/tenis-vermelho.svg' } });

  await host.frame.locator('#hero-title').click({ button: 'right' });
  await menu.locator('[data-action=insert-after]').click();
  await waitEvent(page, 'operation', 2);
  const ins = await lastDraft(host);
  expect(ins).toMatchObject({
    type: 'insertHTML',
    value: { position: 'after', html: '<p class="selo">Novo!</p>' },
  });

  await host.frame.locator('.features h2').click({ button: 'right' });
  await menu.locator('[data-action=hide]').click();
  await waitEvent(page, 'operation', 3);

  await host.frame.locator('[data-testid=cta-comprar]').click({ button: 'right' });
  await menu.locator('[data-action=copy]').click();
  await expect(host.frame.locator('abt-editor-overlay').locator('.toast')).toContainText(
    '[data-testid="cta-comprar"]',
  );

  const ops = (await host.events<{ draft: Draft }>('operation')).map((e, i) => ({
    ...e.draft,
    id: `o${i}`,
    order: i,
  }));
  const r = await host.call<{ applied: unknown[]; failed: unknown[] }>('applyVariation', { operations: ops });
  expect(r.failed).toEqual([]);
  await expect(host.frame.locator('.hero-img')).toHaveAttribute('src', '/tenis-vermelho.svg');
  await expect(host.frame.locator('.selo')).toHaveText('Novo!');
  await expect(host.frame.locator('.features h2')).toBeHidden();
});
