import type { TrackingEvent } from '@abtest/shared';
import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { apiToken } from '../host';

const SITE = 'http://localhost:5180/';

/**
 * Fluxo completo (tarefa 4.4): criar → editar → configurar tráfego e meta → publicar →
 * visitante real (sem interceptação: snippet e config vêm da CDN local da API) cai na variação e converte.
 */
test('criar → editar → tráfego e meta → publicar → visitante cai na variação', async ({
  page,
  browser,
  request,
}) => {
  const site = await openEditor(page);

  // Editar.
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Tênis com 30% OFF hoje');
  await page.keyboard.press('Enter');
  await expect(site.locator('#hero-title')).toHaveText('Tênis com 30% OFF hoje');

  // Configurar: em execução, 100% do tráfego, tudo na variação, meta de clique no CTA.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('running');
  await page.getByTestId('traffic').fill('100');
  await page.getByTestId('traffic').blur();
  await page.getByTestId('weight-controle').fill('0');
  await page.getByTestId('weight-controle').blur();
  await page.getByTestId('weight-variacao-1').fill('100');
  await page.getByTestId('weight-variacao-1').blur();
  await page.getByTestId('goal-type').selectOption('click');
  // Sem seletor: aviso visível em vez de não fazer nada.
  await page.getByTestId('goal-add').click();
  await expect(page.getByTestId('goal-error')).toBeVisible();
  // Meta escolhida clicando no site: a janela fecha, o clique no CTA preenche o seletor e ela reabre.
  await page.getByTestId('goal-pick').click();
  await expect(page.getByTestId('goal-picking')).toBeVisible();
  await site.getByTestId('cta-comprar').click();
  await expect(page.getByTestId('goal-value')).toHaveValue('[data-testid="cta-comprar"]');
  await page.getByTestId('goal-name').fill('Clique em comprar');
  await page.getByTestId('goal-add').click();
  await expect(page.getByTestId('goal')).toContainText('clique-em-comprar');
  // Regra de URL nova aparece vazia e com foco.
  await page.getByTestId('add-url-rule').click();
  await expect(page.getByPlaceholder('parte da URL, ex.: /produto/').last()).toBeFocused();
  await page.getByRole('button', { name: 'Remover regra' }).last().click();
  await page.getByTestId('settings-done').click();

  // Publicar.
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('Publicado (versão');
  const expId = new URL(page.url()).searchParams.get('exp')!;

  // Visitante novo, outro contexto: snippet e config vêm da CDN real da API (nada interceptado).
  const visitor = await browser.newContext();
  // Só observa os lotes enviados ao /collect real (o evento segue para a API).
  const sent: TrackingEvent[] = [];
  await visitor.route('**/collect', async (r) => {
    sent.push(...(JSON.parse(r.request().postData() ?? '{}').events ?? []));
    await r.continue();
  });
  const vp = await visitor.newPage();
  await vp.goto(SITE);
  await expect(vp.locator('#hero-title')).toHaveText('Tênis com 30% OFF hoje');
  const assignments = await vp.evaluate(() =>
    (window as unknown as { abt: { assignments(): Record<string, string> } }).abt.assignments(),
  );
  expect(Object.values(assignments)).toContain('variacao-1');

  // Conversão: clique no CTA envia o evento para /collect da API (sendBeacon).
  await vp.getByTestId('cta-comprar').click();
  await expect
    .poll(() => sent.find((e) => e.type === 'conversion' && e.experimentId === expId))
    .toMatchObject({
      experimentId: expId,
      variationKey: 'variacao-1',
      goalKey: 'clique-em-comprar',
    });
  expect(sent.find((e) => e.type === 'exposure' && e.experimentId === expId)).toBeDefined();
  await visitor.close();

  // Controle intacto para quem não está no experimento: pausar, republicar e conferir com visitante novo.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('status-select').selectOption('paused');
  await page.getByTestId('settings-done').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('notice').last()).toContainText('não entra na publicação');
  const v2 = await browser.newContext();
  const p2 = await v2.newPage();
  await p2.goto(SITE);
  await expect(p2.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await v2.close();

  // Contrato público da publicação.
  const cfg = await (await request.get('http://localhost:4000/cdn/demo.json')).json();
  // Só o nosso: outros testes publicam em paralelo na mesma conta.
  expect(cfg.experiments.map((e: { id: string }) => e.id)).not.toContain(expId);
  expect(await apiToken(request)).toBeTruthy();
});
