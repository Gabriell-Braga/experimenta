import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { apiToken } from '../host';

const API = 'http://localhost:4000';

test('painel de saúde: falhas e curas por alteração; adotar seletor curado', async ({ page, request }) => {
  const site = await openEditor(page);
  // Duas alterações: texto no título e esconder o h2.
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Novo');
  await page.keyboard.press('Enter');
  await site.locator('.features h2').click({ button: 'right' });
  await site.locator('abt-editor-overlay').locator('[data-action=hide]').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo');

  // Eventos como os que o snippet enviaria do site publicado.
  const id = new URL(page.url()).searchParams.get('exp')!;
  const rec = await (
    await request.get(`${API}/experiments/${id}`, {
      headers: { authorization: `Bearer ${await apiToken(request)}` },
    })
  ).json();
  const v = rec.experiment.variations[1];
  const [opText, opHide] = v.operations;
  const base = {
    ts: Date.now(),
    accountId: 'demo',
    visitorId: 'vis',
    url: 'http://localhost:5180/',
    experimentId: id,
    experimentKey: rec.experiment.key,
    variationId: v.id,
    variationKey: v.key,
  };
  const n = () => `${Date.now()}-${Math.random()}`;
  const events = [
    ...Array.from({ length: 4 }, () => ({ ...base, eventId: n(), type: 'exposure' })),
    {
      ...base,
      eventId: n(),
      type: 'selector_failed',
      operationId: opText.id,
      selector: opText.target.selector,
    },
    {
      ...base,
      eventId: n(),
      type: 'selector_healed',
      operationId: opHide.id,
      selector: opHide.target.selector,
      healedSelector: 'section.features > h2',
      via: 'fingerprint',
    },
  ];
  expect(
    (
      await request.post(`${API}/collect`, {
        data: JSON.stringify({ events }),
        headers: { 'content-type': 'text/plain' },
      })
    ).status(),
  ).toBe(204);

  await page.getByTestId('side-health').click();
  await expect(page.getByTestId('health-summary')).toHaveText('2 alteração(ões) com problema');
  const ops = page.getByTestId('health-op');
  await expect(ops.nth(0)).toHaveAttribute('data-state', 'failed');
  await expect(ops.nth(0)).toContainText('não encontrou o elemento 1× (25% das exposições)');
  await expect(ops.nth(1)).toHaveAttribute('data-state', 'healed');
  await expect(ops.nth(1)).toContainText('section.features > h2');

  // Adotar: seletor principal muda, o antigo vira alternativo, e a variação continua aplicando.
  await ops.nth(1).getByTestId('adopt').click();
  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('change').nth(1)).toContainText('section.features > h2');
  await expect(site.locator('.features h2')).toBeHidden();
});
