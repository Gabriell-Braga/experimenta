import { expect, test } from '@playwright/test';
import { login, OWNER } from '../editor';

const API = 'http://localhost:4000';

test('assistente de relatório: sem IA explica por regras e cria a ideia no backlog; com IA (falsa) mostra o texto dela', async ({
  page,
  request,
}) => {
  const { token } = (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as {
    token: string;
  };
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const id = `exp_e2a_${Math.random().toString(36).slice(2, 8)}`;
  const experiment = {
    id,
    key: id.replace(/_/g, '-'),
    name: `Assistente ${id.slice(-6)}`,
    status: 'paused',
    hypothesis: 'Frete grátis em destaque aumenta a compra',
    variations: [
      { id: `${id}_c`, key: 'controle', name: 'Controle', weight: 50 },
      { id: `${id}_b`, key: 'b', name: 'Frete em destaque', weight: 50 },
    ],
    goals: [{ id: `${id}_g1`, key: 'compra', type: 'custom', event: 'compra' }],
  };
  expect(
    (
      await request.post(`${API}/experiments`, {
        headers,
        data: { projectId: projects[0]!.id, editorUrl: 'http://localhost:5180/', experiment },
      })
    ).status(),
  ).toBe(201);
  // Controle converte 80%, a variação 10%, 500 por variação em 9 dias: amostra planejada e semana completa (D-097).
  const events = [];
  for (let i = 0; i < 1000; i++) {
    const arm = i % 2 ? 'b' : 'c';
    const base = {
      ts: Date.now() - 777_600 * i,
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
    if (arm === 'c' ? (i >> 1) % 5 !== 0 : (i >> 1) % 10 === 0)
      events.push({
        ...base,
        ...ctx,
        ts: base.ts + 1,
        eventId: `${id}-c${i}`,
        type: 'conversion',
        goalId: `${id}_g1`,
        goalKey: 'compra',
      });
  }
  for (let i = 0; i < events.length; i += 150)
    await request.post(`${API}/collect`, { data: JSON.stringify({ events: events.slice(i, i + 150) }) });

  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  await page.goto(`http://localhost:5173/?view=report&id=${id}`);
  await expect(page.getByTestId('report-row')).toHaveCount(2);

  // A API do E2E não tem chave de IA: explicação por regras, a partir do veredito do relatório.
  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-summary-source')).toContainText('Por regras');
  await expect(page.getByTestId('ai-summary-note')).toContainText('IA não configurada');
  await expect(page.getByTestId('ai-report-summary')).toContainText('Nenhuma variação superou o controle');
  await expect(page.getByTestId('ai-report-summary')).toContainText('10,00%');
  await expect(page.getByTestId('ai-report-confidence')).toHaveText('alta');
  // 9 dias de dados: sem a ressalva de efeito novidade (só aparece com poucos dias).
  await expect(page.getByTestId('ai-report-caveats')).toHaveCount(0);
  await expect(page.getByTestId('ai-report-next')).toHaveAttribute('data-action', 'stop-iterate');
  await expect(page.getByTestId('ai-report-idea')).toContainText(`Nova iteração: ${experiment.name}`);

  // Próximo passo mapeável: cria a ideia no backlog (18.3).
  await page.getByTestId('ai-report-action').click();
  await expect(page.getByTestId('ai-report-backlog')).toBeVisible();
  const backlog = (await (await request.get(`${API}/ai/ideas`, { headers })).json()) as {
    ideas: { title: string; hypothesis: string; metric: string; page: string; source: string }[];
  };
  const idea = backlog.ideas.find((i) => i.title === `Nova iteração: ${experiment.name}`);
  expect(idea).toMatchObject({ source: 'manual', metric: 'compra', page: 'http://localhost:5180/' });
  expect(idea!.hypothesis).toContain('Frete grátis em destaque');

  // Provedor falso (rota interceptada): a tela manda os números que já tem e mostra o texto da IA.
  let sent: { kind: string; experimentId: string; days: number; report: { goals: unknown[] } } | undefined;
  await page.route('**/ai/summary', async (route) => {
    sent = route.request().postDataJSON() as typeof sent;
    await route.fulfill({
      json: {
        kind: 'report',
        summary: {
          summary: 'Frete em destaque vendeu menos: 10,00% contra 25,00% do controle.',
          business: 'A cada 1.000 visitantes, 150 compras a menos.',
          confidence: 'alta',
          caveats: [],
          next: { action: 'implement', variation: 'Controle', text: 'Manter o controle publicado.' },
        },
        source: 'claude',
        model: 'claude-teste',
        createdAt: new Date().toISOString(),
        cached: false,
        stale: false,
      },
    });
  });
  await page.reload();
  await page.getByTestId('ai-summary-run').click();
  await expect(page.getByTestId('ai-report-summary')).toHaveText(
    'Frete em destaque vendeu menos: 10,00% contra 25,00% do controle.',
  );
  await expect(page.getByTestId('ai-summary-source')).toContainText('IA (claude-teste)');
  await expect(page.getByTestId('ai-report-confidence')).toHaveText('alta');
  await expect(page.getByTestId('ai-report-action')).toContainText('Abrir Controle no editor');
  expect(sent).toMatchObject({ kind: 'report', experimentId: id, days: 30 });
  expect(sent!.report.goals).toHaveLength(1);
});
