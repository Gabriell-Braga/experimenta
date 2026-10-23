import { expect, test, type APIRequestContext } from '@playwright/test';
import { login, OWNER } from '../editor';

const API = 'http://localhost:4000';

async function apiToken(request: APIRequestContext) {
  const r = await request.post(`${API}/auth/login`, { data: OWNER });
  return ((await r.json()) as { token: string }).token;
}

test('relatório: tabela por variação, vencedora, CSV e comparação de metas', async ({ page, request }) => {
  const token = await apiToken(request);
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const id = `exp_e2e_${Math.random().toString(36).slice(2, 8)}`;
  const experiment = {
    id,
    key: id.replace(/_/g, '-'),
    name: 'Relatório E2E',
    // Pausado: o relatório não depende do status e não entra na publicação dos outros testes.
    status: 'paused',
    variations: [
      { id: `${id}_c`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'Botão verde', weight: 50 },
    ],
    goals: [
      { id: `${id}_g1`, key: 'compra', type: 'custom', event: 'compra' },
      { id: `${id}_g2`, key: 'cta', type: 'click', selector: '#cta' },
    ],
  };
  expect(
    (
      await request.post(`${API}/experiments`, {
        headers,
        data: { projectId: projects[0]!.id, editorUrl: 'http://localhost:5180/', experiment },
      })
    ).status(),
  ).toBe(201);
  const events = [];
  // 400 por variação espalhados por 9 dias, 80% vs 95%: passa da amostra planejada (~326 por variação) e da
  // semana mínima, então pode declarar vencedora (20.2).
  for (let i = 0; i < 800; i++) {
    const arm = i % 2 ? 'b' : 'c';
    const base = {
      ts: Date.now() - (i % 9) * 86_400_000 - 1000 * i,
      accountId: 'demo',
      visitorId: `${id}-v${i}`,
      url: 'http://localhost:5180/',
    };
    const ctx = {
      experimentId: id,
      experimentKey: experiment.key,
      variationId: `${id}_${arm}`,
      variationKey: arm,
    };
    events.push({ ...base, ...ctx, eventId: `${id}-e${i}`, type: 'exposure' });
    if ((i >> 1) % 20 < (arm === 'b' ? 19 : 16))
      events.push({
        ...base,
        ...ctx,
        ts: base.ts + 1,
        eventId: `${id}-c${i}`,
        type: 'conversion',
        goalId: `${id}_g1`,
        goalKey: 'compra',
        value: 100,
      });
  }
  for (let i = 0; i < events.length; i += 150)
    await request.post(`${API}/collect`, { data: JSON.stringify({ events: events.slice(i, i + 150) }) });

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=report&id=${id}`);
  await expect(page.getByTestId('headline')).toContainText('Botão verde venceu');
  const rows = page.getByTestId('report-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Vencedora');
  await expect(rows.nth(0)).toContainText('400');
  await expect(page.getByTestId('revenue-table')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('report-csv').click();
  expect((await download).suggestedFilename()).toBe(`${experiment.key}-relatorio.csv`);
  await page.getByTestId('compare-goals').click();
  await expect(page.getByTestId('compare-table')).toContainText('cta');
});

test('relatório: teste sequencial, CUPED e alerta de meta de guarda', async ({ page, request }) => {
  const token = await apiToken(request);
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const id = `exp_e2s_${Math.random().toString(36).slice(2, 8)}`;
  const experiment = {
    id,
    key: id.replace(/_/g, '-'),
    name: 'Estatística E2E',
    status: 'paused',
    variations: [
      { id: `${id}_c`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'Botão verde', weight: 50 },
    ],
    goals: [
      { id: `${id}_g1`, key: 'compra', type: 'custom', event: 'compra' },
      { id: `${id}_g2`, key: 'retorno', type: 'custom', event: 'retorno' },
    ],
    stats: { sequential: true, cuped: true, guardrails: [`${id}_g2`] },
  };
  expect(
    (
      await request.post(`${API}/experiments`, {
        headers,
        data: { projectId: projects[0]!.id, editorUrl: 'http://localhost:5180/', experiment },
      })
    ).status(),
  ).toBe(201);
  const events = [];
  const now = Date.now();
  for (let i = 0; i < 600; i++) {
    const arm = i % 2 ? 'b' : 'c';
    const k = i >> 1;
    const at = now - 60_000 - 1000 * i;
    const base = { accountId: 'demo', visitorId: `${id}-v${i}`, url: 'http://localhost:5180/' };
    const ctx = {
      experimentId: id,
      experimentKey: experiment.key,
      variationId: `${id}_${arm}`,
      variationKey: arm,
    };
    events.push({ ...base, ...ctx, ts: at, eventId: `${id}-e${i}`, type: 'exposure' });
    // Atividade anterior ao teste (covariável do CUPED): quem navegou mais compra mais.
    for (let j = 0; j < k % 4; j++)
      events.push({
        ...base,
        ts: at - 3_600_000 * (j + 1),
        eventId: `${id}-p${i}-${j}`,
        type: 'pageview',
        device: 'desktop',
      });
    if (k % 4 >= (arm === 'b' ? 2 : 3))
      events.push({
        ...base,
        ...ctx,
        ts: at + 1,
        eventId: `${id}-c${i}`,
        type: 'conversion',
        goalId: `${id}_g1`,
        goalKey: 'compra',
      });
    // B derruba a meta de guarda.
    if (k % (arm === 'b' ? 10 : 2) === 0)
      events.push({
        ...base,
        ...ctx,
        ts: at + 2,
        eventId: `${id}-r${i}`,
        type: 'conversion',
        goalId: `${id}_g2`,
        goalKey: 'retorno',
      });
  }
  for (let i = 0; i < events.length; i += 150)
    await request.post(`${API}/collect`, { data: JSON.stringify({ events: events.slice(i, i + 150) }) });

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=report&id=${id}`);
  await expect(page.getByTestId('guardrail-alert')).toContainText('Botão verde piora');
  await expect(page.getByTestId('guardrail-alert')).toContainText('retorno');
  await expect(page.getByTestId('headline')).not.toContainText('venceu');
  await expect(page.getByTestId('report-row').nth(1)).toContainText('guarda');
  await expect(page.getByTestId('report-table')).toContainText('p sempre válido');
  await expect(page.getByTestId('cuped-note')).toContainText('variância');
  await expect(page.getByTestId('stats-note')).toContainText('Teste sequencial');
  await expect(page.getByTestId('report-goal').nth(1)).toContainText('guarda');
});
