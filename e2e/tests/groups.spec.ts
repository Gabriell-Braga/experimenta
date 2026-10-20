import { expect, test } from '@playwright/test';
import { login, nav, OWNER } from '../editor';
import { makeConfig, serveSnippet } from '../helpers';

const API = 'http://localhost:4000';

// Grupos mutuamente exclusivos (17.1).
test('tela de grupos: cria com dois testes, divide igualmente, aviso na lista e exclusão', async ({
  page,
  request,
}) => {
  const token = (
    (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as { token: string }
  ).token;
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const tag = Math.random().toString(36).slice(2, 7);
  // Pausados: não mudam o que o site demo recebe nos outros testes.
  for (const n of ['A', 'B'])
    expect(
      (
        await request.post(`${API}/experiments`, {
          headers,
          data: {
            projectId: projects[0]!.id,
            editorUrl: 'http://localhost:5180/',
            experiment: {
              id: `exp_grp_${n}_${tag}`,
              key: `grp-${n.toLowerCase()}-${tag}`,
              name: `Grupo ${n} ${tag}`,
              status: 'paused',
              variations: [{ id: `exp_grp_${n}_${tag}_c`, key: 'controle', name: 'Controle', weight: 100 }],
            },
          },
        })
      ).status(),
    ).toBe(201);

  await login(page);
  await nav(page, 'groups');
  await page.getByTestId('new-group').click();
  const dialog = page.getByTestId('group-editor');
  await dialog.getByTestId('group-name').fill(`Checkout ${tag}`);
  await dialog.getByTestId('group-add').selectOption({ label: `Grupo A ${tag}` });
  await dialog.getByTestId('group-add').selectOption({ label: `Grupo B ${tag}` });
  // Soma passando de 100% bloqueia o salvar.
  await dialog.getByTestId('group-percent').first().fill('80');
  await dialog.getByTestId('group-percent').last().fill('30');
  await expect(dialog.getByTestId('group-total')).toContainText('passa de 100%');
  await expect(dialog.getByTestId('group-save')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Dividir igualmente' }).click();
  await expect(dialog.getByTestId('group-percent').first()).toHaveValue('50');
  await expect(dialog.getByTestId('group-total')).toContainText('100% em uso');
  await dialog.getByTestId('group-save').click();

  const card = page.getByTestId('group-card').filter({ hasText: `Grupo A ${tag}` });
  await expect(card).toContainText(`Grupo B ${tag}`);
  await expect(card.getByTestId('group-warning')).toContainText('não estão em execução');

  // O mesmo teste não entra em outro grupo: some das opções.
  await page.getByTestId('new-group').click();
  await expect(
    page.getByTestId('group-editor').getByTestId('group-add').locator('option', { hasText: tag }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await nav(page, 'tests');
  await expect(
    page
      .getByTestId('experiment-row')
      .filter({ hasText: `Grupo A ${tag}` })
      .getByTestId('row-group'),
  ).toHaveText(`Checkout ${tag} · 50%`);

  await page
    .getByTestId('experiment-row')
    .filter({ hasText: `Grupo A ${tag}` })
    .getByTestId('row-group')
    .click();
  await expect(page.getByTestId('group-card').filter({ hasText: `Grupo A ${tag}` })).toBeVisible();
  await page.getByRole('button', { name: `Excluir Checkout ${tag}` }).click();
  await page.getByTestId('confirm-delete-group').click();
  await expect(page.getByTestId('group-title').filter({ hasText: `Checkout ${tag}` })).toHaveCount(0);
});

test('snippet: no grupo o visitante entra em no máximo um teste, sempre o mesmo', async ({ browser }) => {
  const exp = (id: string, text: string, slots: number[]) => ({
    id,
    key: id,
    name: id,
    status: 'running',
    group: { id: 'grp_e2e', slots },
    variations: [
      { id: `${id}_c`, key: 'controle', name: 'Controle', weight: 0 },
      {
        id: `${id}_b`,
        key: 'b',
        name: 'B',
        weight: 1,
        operations: [
          { id: 'o1', order: 0, type: 'setText', target: { selector: '#hero-title' }, value: text },
        ],
      },
    ],
  });
  const config = makeConfig([
    exp('exp_x', 'Teste X', [...Array(50).keys()]),
    exp(
      'exp_y',
      'Teste Y',
      [...Array(50).keys()].map((i) => i + 50),
    ),
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5180' });
    // Visitantes fixos: resultado determinístico (o hash decide; os dois testes aparecem entre eles).
    await ctx.addCookies([{ name: '_abt_vid', value: `visitante-${i}`, url: 'http://localhost:5180' }]);
    const page = await ctx.newPage();
    await serveSnippet(page, config);
    await page.goto('/');
    await expect(page.locator('#hero-title')).toHaveText(/^Teste [XY]$/);
    const first = await page.locator('#hero-title').textContent();
    expect(Object.keys(await page.evaluate(() => window.abt!.assignments()))).toHaveLength(1);
    await page.reload();
    await expect(page.locator('#hero-title')).toHaveText(first!);
    seen.add(first!);
    await ctx.close();
  }
  expect(seen.size).toBe(2);
});
