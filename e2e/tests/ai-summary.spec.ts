import { expect, test } from '@playwright/test';
import { login, OWNER } from '../editor';

const API = 'http://localhost:4000';
const ORIGIN = { origin: 'http://localhost:5173' };
const uid = () => Math.random().toString(36).slice(2, 10);
const base = (visitorId: string, sessionId: string, ts = Date.now()) => ({
  eventId: `e-${uid()}`,
  ts,
  accountId: 'demo',
  visitorId,
  sessionId,
  url: 'http://localhost:5180/produto.html',
});

test('pesquisa: sem IA resume por palavras-chave (sem e-mail); com IA (falsa) mostra temas e sentimento', async ({
  page,
  request,
}) => {
  const { token } = (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as {
    token: string;
  };
  const created = await request.post(`${API}/entities/survey`, {
    headers: { ...ORIGIN, authorization: `Bearer ${token}` },
    data: {
      name: `Opinião ${uid()}`,
      data: {
        status: 'paused',
        questions: [
          { id: 'nps', type: 'nps', text: 'Recomendaria?' },
          { id: 'txt', type: 'text', text: 'O que podemos melhorar?' },
        ],
      },
    },
  });
  const { id } = (await created.json()) as { id: string };
  const answer = (text: string, nps: number) => ({
    ...base(`v-${uid()}`, `s-${uid()}`),
    type: 'survey',
    surveyId: id,
    completed: true,
    answers: [
      { questionId: 'nps', value: nps },
      { questionId: 'txt', value: text },
    ],
  });
  const events = [
    answer('A entrega demorou demais, me escreva em ana@exemplo.com', 3),
    answer('Entrega atrasou dois dias', 5),
    answer('Gostei do site, entrega ok', 9),
  ];
  expect((await request.post(`${API}/collect`, { data: JSON.stringify({ events }) })).status()).toBe(204);

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=survey&id=${id}`);

  // A API do E2E não tem chave de IA: a pesquisa cai no resumo por palavras-chave.
  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-summary-source')).toContainText('Por palavras-chave');
  await expect(page.getByTestId('ai-summary-note')).toContainText('IA não configurada');
  await expect(page.getByTestId('ai-summary-theme').first()).toContainText('entrega');
  await expect(page.getByTestId('ai-summary-theme').first()).toContainText('3 respostas');
  await expect(page.getByTestId('ai-summary-result')).toContainText('[e-mail]');
  await expect(page.getByTestId('ai-summary-result')).not.toContainText('ana@exemplo.com');

  // Provedor falso (rota interceptada): "Atualizar" pede de novo e mostra os temas da IA.
  let sent: { kind: string; surveyId: string; refresh?: boolean } | undefined;
  await page.route('**/ai/summary', async (route) => {
    sent = route.request().postDataJSON() as typeof sent;
    await route.fulfill({
      json: {
        kind: 'survey',
        summary: {
          sentiment: 'negativo',
          overview: 'A maioria reclama do prazo de entrega.',
          themes: [
            {
              name: 'Prazo de entrega',
              count: 2,
              sentiment: 'negativo',
              examples: ['Entrega atrasou dois dias'],
            },
            { name: 'Site', count: 1, sentiment: 'positivo', examples: ['Gostei do site'] },
          ],
        },
        source: 'claude',
        model: 'falso',
        createdAt: new Date().toISOString(),
        cached: false,
        stale: false,
      },
    });
  });
  await page.getByTestId('ai-summary-refresh').click();
  await expect(page.getByTestId('ai-summary-sentiment')).toHaveText('negativo');
  await expect(page.getByTestId('ai-summary-theme')).toHaveCount(2);
  await expect(page.getByTestId('ai-summary-theme').first()).toContainText('Prazo de entrega');
  await expect(page.getByTestId('ai-summary-source')).toContainText('IA (falso)');
  expect(sent).toMatchObject({ kind: 'survey', surveyId: id, refresh: true });
});

test('gravação: sem IA avisa; com IA (falsa) mostra objetivo, passos, onde travou e frustração', async ({
  page,
  request,
}) => {
  const sessionId = `s-${uid()}`;
  const visitorId = `v-${uid()}`;
  const t0 = Date.now() - 60_000;
  const rec = await request.post(`${API}/rec`, {
    headers: { 'content-type': 'text/plain' },
    data: JSON.stringify({
      accountId: 'demo',
      sessionId,
      visitorId,
      device: 'desktop',
      vw: 1280,
      vh: 720,
      events: [
        {
          type: 4,
          timestamp: t0,
          data: { href: 'http://localhost:5180/produto.html', width: 1280, height: 720 },
        },
        {
          type: 3,
          timestamp: t0 + 5000,
          data: { source: 1, positions: [{ x: 1, y: 1, id: 1, timeOffset: 0 }] },
        },
      ],
    }),
  });
  expect(rec.status()).toBe(204);
  const hm = { device: 'desktop', variations: {} };
  const events = [
    { ...base(visitorId, sessionId, t0), type: 'pageview', device: 'desktop', title: 'Produto' },
    {
      ...base(visitorId, sessionId, t0 + 3000),
      ...hm,
      type: 'frustration',
      kind: 'rage',
      selector: '#frete',
      rx: 0.5,
      ry: 0.5,
      count: 3,
    },
  ];
  expect((await request.post(`${API}/collect`, { data: JSON.stringify({ events }) })).status()).toBe(204);

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=recording&id=${sessionId}`);

  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-summary-error')).toContainText('IA não configurada');

  let sent: { kind: string; sessionId: string } | undefined;
  await page.route('**/ai/summary', async (route) => {
    sent = route.request().postDataJSON() as typeof sent;
    await route.fulfill({
      json: {
        kind: 'recording',
        summary: {
          goal: 'Calcular o frete do tênis',
          steps: ['Abriu a página do produto', 'Tentou calcular o frete'],
          stuck: 'No cálculo de frete, que não respondeu',
          frustration: ['Cliques repetidos em #frete'],
        },
        source: 'modelo',
        model: 'falso',
        createdAt: new Date().toISOString(),
        cached: true,
        stale: false,
      },
    });
  });
  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-summary-goal')).toHaveText('Calcular o frete do tênis');
  await expect(page.getByTestId('ai-summary-steps').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('ai-summary-stuck')).toContainText('frete');
  await expect(page.getByTestId('ai-summary-frustration')).toContainText('#frete');
  expect(sent).toEqual({ kind: 'recording', sessionId });
});

test('mapa de calor: o pedido leva o texto dos elementos lido pelo agent na página real', async ({
  page,
  request,
}) => {
  const vid = `v-${uid()}`;
  const hm = { device: 'desktop', variations: {} };
  const events = [
    { ...base(vid, vid), type: 'pageview', device: 'desktop', title: 'Produto' },
    {
      ...base(vid, vid),
      ...hm,
      type: 'click',
      selector: 'h1',
      rx: 0.5,
      ry: 0.5,
      px: 10,
      py: 10,
      vw: 1280,
      vh: 720,
    },
    { ...base(vid, vid), ...hm, type: 'scroll', depth: 60, vh: 720, ph: 2000 },
  ];
  expect((await request.post(`${API}/collect`, { data: JSON.stringify({ events }) })).status()).toBe(204);
  let sent:
    | { kind: string; url: string; context?: { labels: Record<string, string>; ignored: string[] } }
    | undefined;
  await page.route('**/ai/summary', async (route) => {
    sent = route.request().postDataJSON() as typeof sent;
    await route.fulfill({
      json: {
        kind: 'heatmap',
        summary: { attention: ['O título'], ignored: ['O rodapé'], suggestions: ['Subir o botão de compra'] },
        source: 'modelo',
        model: 'falso',
        createdAt: new Date().toISOString(),
        cached: false,
        stale: false,
      },
    });
  });
  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(
    `http://localhost:5173/?view=heatmap&url=${encodeURIComponent('http://localhost:5180/produto.html')}`,
  );
  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-summary-suggestions')).toContainText('Subir o botão de compra');
  const h1 = await page.frameLocator('[data-testid=site-frame]').locator('h1').innerText();
  expect(sent).toMatchObject({ kind: 'heatmap', url: 'http://localhost:5180/produto.html' });
  expect(sent!.context!.labels.h1).toBe(h1.trim());
  expect(sent!.context!.ignored.length).toBeGreaterThan(0);
});
