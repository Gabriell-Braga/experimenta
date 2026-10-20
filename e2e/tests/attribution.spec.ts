import { expect, test, type Page } from '@playwright/test';
import { login, OWNER } from '../editor';

const API = 'http://localhost:4000';
const SITE = 'http://localhost:5180/';
const DAY = 86_400_000;

/** Linha da tabela de atribuição cujo rótulo é `label`. */
const row = (page: Page, label: string) =>
  page.getByTestId('attribution-row').filter({ has: page.getByText(label, { exact: true }) });

test('receita por canal: primeiro e último toque no painel e no relatório', async ({ page, request }) => {
  const token = (
    (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as { token: string }
  ).token;
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const id = `exp_attr_${Math.random().toString(36).slice(2, 8)}`;
  const buy = `compra_${id}`;
  const experiment = {
    id,
    key: id.replace(/_/g, '-'),
    name: 'Atribuição E2E',
    status: 'paused',
    variations: [
      { id: `${id}_c`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'Variação B', weight: 50 },
    ],
    goals: [{ id: `${id}_g`, key: 'compra', type: 'custom', event: buy }],
  };
  expect(
    (
      await request.post(`${API}/experiments`, {
        headers,
        data: { projectId: projects[0]!.id, editorUrl: SITE, experiment },
      })
    ).status(),
  ).toBe(201);

  // v1 chega pelo Instagram, volta pela newsletter e compra (R$ 300) numa visita direta: primeiro toque =
  // redes sociais, último = e-mail. v2 vem da busca orgânica e compra (R$ 100) na mesma visita.
  const now = Date.now();
  let n = 0;
  const base = (visitorId: string, sessionId: string, ts: number, url = SITE) => ({
    eventId: `${id}-${n++}`,
    accountId: 'demo',
    visitorId: `${id}-${visitorId}`,
    sessionId: `${id}-${sessionId}`,
    ts,
    url,
  });
  const pv = (v: string, s: string, ts: number, url?: string, referrer?: string) => ({
    ...base(v, s, ts, url),
    type: 'pageview',
    device: 'desktop',
    ...(referrer ? { referrer } : {}),
  });
  const purchase = (v: string, s: string, ts: number, value: number, arm: 'c' | 'b') => [
    { ...base(v, s, ts), type: 'event', name: buy, value },
    {
      ...base(v, s, ts),
      type: 'conversion',
      experimentId: id,
      experimentKey: experiment.key,
      variationId: `${id}_${arm}`,
      variationKey: arm,
      goalId: `${id}_g`,
      goalKey: 'compra',
      value,
    },
  ];
  const events = [
    pv('v1', 's1', now - 3 * DAY, `${SITE}?utm_source=instagram&utm_medium=social&utm_campaign=verao`),
    pv('v1', 's2', now - 2 * DAY, `${SITE}?utm_source=newsletter&utm_medium=email&utm_campaign=outubro`),
    pv('v1', 's3', now - DAY),
    ...purchase('v1', 's3', now - DAY + 1000, 300, 'b'),
    pv('v2', 's4', now - DAY, SITE, 'https://www.google.com/'),
    ...purchase('v2', 's4', now - DAY + 1000, 100, 'c'),
  ];
  expect((await request.post(`${API}/collect`, { data: JSON.stringify({ events }) })).status()).toBe(204);

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();

  // Painel: cartão próprio, filtrado pelo evento de compra deste teste.
  await page.goto('http://localhost:5173/?view=home');
  await page.getByTestId('attribution-event').selectOption(buy);
  const card = page.getByTestId('attribution');
  await expect(row(page, 'E-mail')).toContainText(/R\$\s300,00/);
  await expect(row(page, 'Busca orgânica')).toContainText(/R\$\s100,00/);
  await expect(row(page, 'Redes sociais')).toHaveCount(0);
  await card.getByRole('tab', { name: 'Primeiro toque' }).click();
  await expect(row(page, 'Redes sociais')).toContainText(/R\$\s300,00/);
  await expect(row(page, 'E-mail')).toHaveCount(0);
  await card.getByRole('tab', { name: 'Campanha' }).click();
  await expect(row(page, 'verao')).toContainText('75%');

  // Relatório do experimento: sob demanda, por variação.
  await page.goto(`http://localhost:5173/?view=report&id=${id}`);
  await page.getByTestId('attribution-open').click();
  const email = row(page, 'E-mail');
  await expect(email).toContainText(/R\$\s300,00/);
  await expect(email.locator('td').nth(1)).toHaveText(/^0R\$\s0,00$/); // controle
  await expect(email.locator('td').nth(2)).toHaveText(/^1R\$\s300,00$/); // variação B
  await page.getByTestId('attribution').getByRole('tab', { name: 'Primeiro toque' }).click();
  await expect(row(page, 'Redes sociais')).toContainText(/R\$\s300,00/);
  await expect(row(page, 'Busca orgânica').locator('td').nth(1)).toHaveText(/^1R\$\s100,00$/);
});
