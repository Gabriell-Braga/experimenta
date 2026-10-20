import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { EDITOR, nav } from '../editor';

const API = 'http://localhost:4000';

// Backlog de hipóteses (18.3). Conta própria: outros testes limpam as ideias da demo.
async function setup(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'demo@abtest.dev', password: 'demo1234' },
  });
  const demo = ((await login.json()) as { token: string }).token;
  const acc = await request.post(`${API}/accounts`, {
    data: { name: 'Loja do backlog', siteUrl: 'https://backlog.example/' },
    headers: { authorization: `Bearer ${demo}` },
  });
  expect(acc.ok()).toBe(true);
  const token = ((await acc.json()) as { token: string }).token;
  const headers = { authorization: `Bearer ${token}` };
  const [project] = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const exp = await request.post(`${API}/experiments`, {
    headers,
    data: {
      projectId: project!.id,
      editorUrl: 'https://backlog.example/',
      experiment: {
        id: 'exp_backlog_frete',
        key: 'frete-topo',
        name: 'Frete no topo',
        status: 'running',
        variations: [
          { id: 'v0', key: 'controle', name: 'Controle', weight: 1 },
          { id: 'v1', key: 'frete', name: 'Frete', weight: 1 },
        ],
        goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
      },
    },
  });
  expect(exp.status()).toBe(201);
  return { token, headers };
}

async function as(browser: Browser, token: string) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('abt-token', t), token);
  const page = await ctx.newPage();
  await page.goto(EDITOR);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  return page;
}

test('backlog: ideia manual, priorizar (ICE), mover (menu e arrastar), ligar a teste e resultado', async ({
  browser,
  request,
}) => {
  const { token, headers } = await setup(request);
  const page = await as(browser, token);
  await nav(page, 'optimize');
  const col = (s: string) => page.getByTestId(`stage-${s}`);
  const card = (t: string) => page.getByTestId('idea').filter({ hasText: t });

  const create = async (title: string, hypothesis: string) => {
    await page.getByTestId('idea-new').click();
    await page.getByTestId('idea-title').fill(title);
    await page.getByTestId('idea-hypothesis').fill(hypothesis);
    await page.getByTestId('idea-page').fill('/carrinho');
    await page.getByTestId('idea-metric').fill('compra');
    await page.getByTestId('idea-save').click();
    await expect(page.getByTestId('idea-form')).toBeHidden();
  };
  await create('Frete grátis no topo', 'Se o frete grátis aparecer antes, mais gente compra');
  await create('Selo de compra segura', 'Confiança no checkout');
  await expect(col('idea').getByTestId('idea')).toHaveCount(2);
  await expect(card('Frete grátis no topo')).toContainText('/carrinho');

  // Priorizar: ICE com score ao vivo; a ideia vai para "Priorizadas".
  const ice = async (t: string, impact: number, confidence: number, ease: number, score: string) => {
    await card(t).getByTestId('idea-prioritize').click();
    await page.getByTestId('ice-impact').fill(String(impact));
    await page.getByTestId('ice-confidence').fill(String(confidence));
    await page.getByTestId('ice-ease').fill(String(ease));
    await expect(page.getByTestId('ice-score')).toHaveText(score);
    await page.getByTestId('ice-save').click();
    await expect(col('prioritized').getByTestId('idea').filter({ hasText: t })).toBeVisible();
  };
  await ice('Selo de compra segura', 4, 5, 6, '5');
  await ice('Frete grátis no topo', 9, 6, 8, '7,7');
  // Maior ICE primeiro.
  await expect(col('prioritized').getByTestId('idea-score')).toHaveText(['ICE 7,7', 'ICE 5']);

  // Mover pelo menu (teclado) e de volta arrastando.
  await card('Selo de compra segura').getByTestId('idea-move').selectOption('idea');
  await expect(col('idea').getByTestId('idea')).toHaveCount(1);
  await card('Selo de compra segura').dragTo(col('prioritized'));
  await expect(col('prioritized').getByTestId('idea')).toHaveCount(2);
  // Sem teste, "Em teste" não é opção.
  await expect(card('Selo de compra segura').getByTestId('idea-move').locator('option')).toHaveText([
    'Mover…',
    'Ideias',
    'Concluídas',
  ]);

  // Ligar a um teste existente: "Em teste", com o status do teste.
  const frete = card('Frete grátis no topo');
  await frete.getByTestId('idea-more').click();
  await frete.getByTestId('idea-link').click();
  await page.getByTestId('idea-link-select').selectOption({ label: 'Frete no topo' });
  await page.getByTestId('idea-link-save').click();
  await expect(col('testing').getByTestId('idea')).toHaveCount(1);
  await expect(frete.getByTestId('idea-open-test')).toHaveText('Frete no topo');
  await expect(frete).toContainText('Em execução');
  await expect(frete.getByTestId('idea-move').locator('option')).toHaveText(['Mover…', 'Concluídas']);

  // Teste arquivado = concluída, com o resultado do relatório.
  const r = await request.patch(`${API}/experiments/exp_backlog_frete/status`, {
    headers,
    data: { status: 'archived' },
  });
  expect(r.ok()).toBe(true);
  await page.reload();
  await expect(col('done').getByTestId('idea')).toHaveCount(1);
  await expect(card('Frete grátis no topo').getByTestId('idea-result')).toContainText('Inconclusivo');

  // Histórico de atividades.
  await nav(page, 'activity');
  await expect(page.getByText(/priorizou a ideia Frete grátis no topo \(ICE 7,7\)/)).toBeVisible();
  await expect(page.getByText(/ligou a ideia Frete grátis no topo ao teste Frete no topo/)).toBeVisible();
  await expect(page.getByText(/moveu a ideia Selo de compra segura para Priorizadas/)).toBeVisible();
});
