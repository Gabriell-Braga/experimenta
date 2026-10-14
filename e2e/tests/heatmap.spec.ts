import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { apiToken } from '../host';

const API = 'http://localhost:4000';

test('mapa de calor sobre o site real: pontos, contagem por elemento, faixas de scroll e filtros', async ({
  page,
  request,
}) => {
  const site = await openEditor(page);
  const expId = new URL(page.url()).searchParams.get('exp')!;
  const rec = await (
    await request.get(`${API}/experiments/${expId}`, {
      headers: { authorization: `Bearer ${await apiToken(request)}` },
    })
  ).json();
  const [control, varB] = rec.experiment.variations;
  const n = () => `${Date.now()}-${Math.random()}`;
  const base = (variationId: string, device = 'desktop') => ({
    ts: Date.now(),
    accountId: 'demo',
    visitorId: n(),
    url: 'http://localhost:5180/?utm=x',
    device,
    variations: { [expId]: variationId },
  });
  const click = (variationId: string, selector: string, device?: string) => ({
    ...base(variationId, device),
    eventId: n(),
    type: 'click',
    selector,
    rx: 0.5,
    ry: 0.5,
    px: 0,
    py: 0,
    vw: 1280,
    vh: 720,
  });
  const events = [
    click(varB.id, '#hero > a'),
    click(varB.id, '#hero > a'),
    click(varB.id, '#hero > a', 'mobile'),
    click(control.id, '#hero-title'),
    { ...base(varB.id), eventId: n(), type: 'scroll', depth: 100, vh: 720, ph: 1500 },
    { ...base(control.id), eventId: n(), type: 'scroll', depth: 30, vh: 720, ph: 1500 },
  ];
  await request.post(`${API}/collect`, {
    data: JSON.stringify({ events }),
    headers: { 'content-type': 'text/plain' },
  });

  await page.getByTestId('mode-heatmap').click();
  await page.getByTestId('heatmap-variation').selectOption(varB.id);
  await expect(page.getByTestId('heatmap-summary')).toContainText('3 cliques');
  const overlay = site.locator('abt-editor-overlay');
  await expect(overlay.locator('.heat-badge[data-selector="#hero > a"]')).toHaveText('3');
  await expect(overlay.locator('canvas.heat')).toHaveCount(1);
  await expect(overlay.locator('.heat-band').first()).toContainText('chegaram aqui');

  // Pixels coloridos no canvas sobre o CTA.
  const colored = await site.locator('body').evaluate(() => {
    const c = document.querySelector('abt-editor-overlay')!.shadowRoot!.querySelector('canvas')!;
    const a = document.querySelector('[data-testid=cta-comprar]')!.getBoundingClientRect();
    const d = devicePixelRatio;
    const px = c
      .getContext('2d')!
      .getImageData((a.left + a.width / 2) * d, (a.top + a.height / 2) * d, 1, 1).data;
    return px[3]! > 0;
  });
  expect(colored).toBe(true);

  // Filtro por dispositivo.
  await page.getByTestId('heatmap-device').selectOption('mobile');
  await expect(page.getByTestId('heatmap-summary')).toContainText('1 cliques');
  await expect(overlay.locator('.heat-badge[data-selector="#hero > a"]')).toHaveText('1');

  // Controle: outro elemento.
  await page.getByTestId('heatmap-device').selectOption('');
  await page.getByTestId('heatmap-variation').selectOption(control.id);
  await expect(overlay.locator('.heat-badge[data-selector="#hero-title"]')).toHaveText('1');

  // Sair do modo esconde o mapa.
  await page.getByTestId('mode-edit').click();
  await expect(overlay.locator('.heat-badge')).toHaveCount(0);
});
