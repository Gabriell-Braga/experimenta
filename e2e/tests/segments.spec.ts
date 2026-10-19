import { expect, test } from '@playwright/test';
import { login } from '../editor';

test('segmento do CDP: cria por regras do perfil, lista membros e exporta CSV', async ({ page, request }) => {
  const u = `seg-${Math.random().toString(36).slice(2, 7)}`;
  const b = { accountId: 'demo', url: 'http://localhost:5180/', ts: Date.now() - 1000 };
  await request.post('http://localhost:4000/collect', {
    data: JSON.stringify({
      events: [
        {
          ...b,
          eventId: `${u}1`,
          visitorId: `${u}-a`,
          sessionId: `${u}-s1`,
          type: 'pageview',
          device: 'mobile',
        },
        {
          ...b,
          eventId: `${u}2`,
          visitorId: `${u}-a`,
          sessionId: `${u}-s1`,
          type: 'identify',
          userId: u,
          attrs: { plano: u },
        },
      ],
    }),
  });
  await login(page);
  await page.getByTestId('nav-segments').click();
  await page.getByTestId('new-segment').click();
  await page.getByTestId('segment-name').fill(`Plano ${u}`);
  const editor = page.getByTestId('segment-editor');
  await editor.getByLabel('Campo').selectOption('attribute');
  await editor.getByPlaceholder('atributo').fill('plano');
  await editor.locator('input:not([placeholder])').last().fill(u);
  await page.getByTestId('segment-save').click();
  await expect(page.getByTestId('segment-count')).toHaveText('1 perfis');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^segmento-.*\.csv$/);
});
