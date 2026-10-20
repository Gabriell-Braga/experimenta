import { readFileSync } from 'node:fs';
import { compileIntegrations } from '@abtest/shared';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { login, nav } from '../editor';
import { experiment, makeConfig, serveSnippet } from '../helpers';

const API = 'http://localhost:4000';

test('Segment, Mixpanel e Amplitude da página recebem exposição e conversão; GA4/GTM seguem iguais', async ({
  page,
}) => {
  // Ferramentas falsas, como os stubs dos snippets oficiais: só registram as chamadas.
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    for (const k of ['analytics', 'mixpanel', 'amplitude'])
      w[k] = { track: (...a: unknown[]) => calls.push([k, ...a]) };
    w.gtag = (...a: unknown[]) => calls.push(['gtag', ...a]);
  });
  await serveSnippet(
    page,
    makeConfig(
      [
        experiment(
          [{ id: 'o1', order: 0, type: 'setText', target: { selector: '#hero-title' }, value: 'Corra mais' }],
          { goals: [{ id: 'g1', key: 'compra', name: 'Compra', type: 'custom', event: 'compra' }] },
        ),
      ],
      {
        integrations: compileIntegrations({
          ga4: true,
          segment: { enabled: true },
          mixpanel: { enabled: true },
          amplitude: { enabled: true, conversions: false },
        }),
      },
    ),
  );
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText('Corra mais');
  await page.evaluate(() => {
    (window.abq as { push(c: unknown[]): void }).push(['track', 'compra', 120]);
    window.abt!.flush();
  });
  const calls = () => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls);
  await expect.poll(async () => (await calls()).length).toBe(6);
  expect(await calls()).toEqual(
    expect.arrayContaining([
      ['gtag', 'event', 'experiment_impression', { experiment_id: 'hero', variant_id: 'b' }],
      ['analytics', 'Experiment Viewed', { experiment_id: 'hero', variation_id: 'b' }],
      ['mixpanel', '$experiment_started', { 'Experiment name': 'hero', 'Variant name': 'b' }],
      ['amplitude', 'Experiment Viewed', { experiment_id: 'hero', variation_id: 'b' }],
      [
        'analytics',
        'Experiment Converted',
        { experiment_id: 'hero', variation_id: 'b', goal: 'compra', value: 120 },
      ],
      [
        'mixpanel',
        'Experiment Converted',
        { 'Experiment name': 'hero', 'Variant name': 'b', Goal: 'compra', value: 120 },
      ],
    ]),
  );
});

test('tela: liga o Mixpanel com evento próprio e publica; Shopify e plugin do WordPress com o script da conta', async ({
  page,
  request,
}) => {
  await login(page);
  await nav(page, 'integrations');
  const mix = page.getByTestId('integration-mixpanel');
  await mix.getByRole('switch', { name: 'Mixpanel' }).click();
  await expect(mix.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await mix.getByText('Configurar eventos').click();
  await page.getByTestId('mixpanel-exposure').fill('Teste visto');
  await page.getByTestId('mixpanel-save').click();
  await expect(mix).toContainText("mixpanel.track('Teste visto'");
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${API}/cdn/demo.json`)).json()) as { integrations?: unknown[][] })
          .integrations,
    )
    .toContainEqual([
      'mixpanel',
      'Teste visto',
      'Experiment Converted',
      'Experiment name',
      'Variant name',
      'Goal',
    ]);

  await expect(page.getByTestId('shopify-theme')).toContainText(`${API}/cdn/demo.js`);
  await expect(page.getByTestId('shopify-pixel')).toContainText(`${API}/cdn/demo.json`);
  await page.getByRole('tab', { name: 'WordPress' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('wordpress-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('experimenta-wordpress.zip');
  const files = unzipSync(readFileSync((await download.path())!));
  const php = strFromU8(files['experimenta/experimenta.php']!);
  expect(php).toContain(`const EXPERIMENTA_DEFAULT_URL = '${API}/cdn/demo.js';`);
  expect(php).toContain("add_action('wp_head'");

  // Desliga de novo para não afetar outros testes.
  await mix.getByRole('switch', { name: 'Mixpanel' }).click();
  await expect(mix.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('tela do CRM: token do HubSpot só escrita, campos sugeridos e ligar exige token', async ({ page }) => {
  await login(page);
  await nav(page, 'integrations');
  const hs = page.getByTestId('crm-hubspot');
  await hs.getByRole('switch', { name: 'Ligar HubSpot' }).click();
  await hs.getByTestId('crm-hubspot-save').click();
  await expect(
    page.getByText('HubSpot: informe o token do app privado do HubSpot antes de ligar.'),
  ).toBeVisible();
  await hs.getByLabel('Token do HubSpot').fill('pat-na1-segredo-e2e');
  await hs.getByTestId('hubspot-defaults').click();
  await expect(hs.getByLabel('Campo no CRM').first()).toHaveValue('abt_segments');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/integrations/crm') && r.request().method() === 'PUT',
  );
  await hs.getByTestId('crm-hubspot-save').click();
  const body = await (await saved).text();
  expect(body).not.toContain('pat-na1-segredo-e2e');
  await expect(hs).toContainText('Ligado: sincroniza de hora em hora');
  await expect(hs.getByLabel('Token do HubSpot')).toHaveValue('');
  await expect(hs.getByLabel('Token do HubSpot')).toHaveAttribute('placeholder', /guardado/);
  await expect(hs.getByTestId('crm-hubspot-sync')).toBeVisible();

  // Salesforce: domínio fora do Salesforce é recusado.
  await page.getByRole('tab', { name: 'Salesforce' }).click();
  const sf = page.getByTestId('crm-salesforce');
  await sf.getByLabel('Domínio da org Salesforce').fill('https://intranet.local');
  await sf.getByTestId('crm-salesforce-save').click();
  await expect(page.getByText(/use o domínio da org/)).toBeVisible();

  // Desliga o HubSpot (o job de hora em hora não deve chamar a API real nos outros testes).
  await page.getByRole('tab', { name: 'HubSpot' }).click();
  await hs.getByRole('switch', { name: 'Ligar HubSpot' }).click();
  await hs.getByTestId('crm-hubspot-save').click();
  await expect(hs).toContainText('Desligado');
});

test('webhook fora do ar: entrega vai para a fila, aparece no histórico e "Reenviar" tenta de novo', async ({
  page,
  request,
}) => {
  await login(page);
  await nav(page, 'integrations');
  await page.getByTestId('webhook-url').fill('http://127.0.0.1:9/fora-do-ar');
  await page.getByText('Publicação', { exact: true }).click();
  await page.getByTestId('webhook-add').click();
  const row = page.getByTestId('webhooks').locator('li', { hasText: '127.0.0.1:9/fora-do-ar' });
  await expect(row).toBeVisible();

  const { token } = (await (
    await request.post(`${API}/auth/login`, {
      data: { email: 'demo@abtest.dev', password: 'demo1234' },
      headers: { origin: 'http://localhost:5173' },
    })
  ).json()) as { token: string };
  expect(
    (
      await request.post(`${API}/publish`, {
        data: {},
        headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' },
      })
    ).status(),
  ).toBe(200);

  await row.getByTestId('webhook-deliveries-toggle').click();
  const list = row.getByTestId('webhook-deliveries');
  await expect(async () => {
    await row.getByTestId('webhook-deliveries-toggle').click();
    await row.getByTestId('webhook-deliveries-toggle').click();
    await expect(list).toContainText('Na fila', { timeout: 1000 });
  }).toPass();
  await expect(list).toContainText('tentativa 1 de 6');
  await expect(list).toContainText('sem conexão com o destino');
  await list.getByTestId('webhook-retry').first().click();
  await expect(page.getByText(/Falhou de novo/)).toBeVisible();
  await expect(list).toContainText('Falhou');
  await expect(list).toContainText('tentativa 2 de 6');

  await row.getByRole('button', { name: 'Excluir' }).click();
  await expect(row).toHaveCount(0);
});

test('exportação: ligar S3 exige bucket; CSV com "Exportar agora" mostra a última execução', async ({
  page,
}) => {
  await login(page);
  await nav(page, 'integrations');
  const box = page.getByTestId('data-export');
  await box.getByRole('switch', { name: 'Ligar exportação' }).click();
  await box.getByRole('tab', { name: 'S3 / R2 / GCS' }).click();
  await box.getByTestId('export-save').click();
  await expect(page.getByText('Exportação: informe o bucket antes de ligar.')).toBeVisible();

  await box.getByRole('tab', { name: 'CSV (baixar aqui)' }).click();
  await box.getByTestId('export-save').click();
  await expect(box).toContainText('Ligada');
  await expect(box.getByTestId('export-status')).toContainText('Próxima:');
  await box.getByTestId('export-run').click();
  await expect(box.getByTestId('export-status')).toContainText(/Última exportação .*\(manual\)/);

  await box.getByRole('switch', { name: 'Ligar exportação' }).click();
  await box.getByTestId('export-save').click();
  await expect(box).toContainText('Desligada');
});
