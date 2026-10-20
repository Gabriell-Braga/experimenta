import { expect, test } from '@playwright/test';
import { EDITOR, login, nav, OWNER } from '../editor';

const API = 'http://localhost:4000';

// Comentários e @menções (16.6): owner comenta no relatório mencionando o editor; o editor vê o contador,
// abre a menção e cai no teste; texto com HTML aparece como texto.
test('comentário com @menção avisa o mencionado; HTML vira texto; autor exclui', async ({
  browser,
  request,
}) => {
  const token = (
    (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as { token: string }
  ).token;
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const id = `exp_cmt_${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(`${API}/experiments`, {
    headers,
    data: {
      projectId: projects[0]!.id,
      editorUrl: 'http://localhost:5180/',
      experiment: {
        id,
        key: id.replace(/_/g, '-'),
        name: 'Comentários E2E',
        status: 'paused',
        variations: [{ id: `${id}_c`, key: 'controle', name: 'Controle', weight: 100 }],
      },
    },
  });
  expect(created.status()).toBe(201);

  const owner = await (await browser.newContext()).newPage();
  await login(owner);
  await expect(owner.getByTestId('user-menu')).toBeVisible();
  await owner.goto(`${EDITOR}?view=report&id=${id}`);
  await expect(owner.getByTestId('comments-empty')).toBeVisible();
  const input = owner.getByTestId('comment-input');
  await input.fill('Revisar o <img src=x onerror="window.__xss=1"> com ');
  await input.pressSequentially('@editor');
  await owner.getByTestId('mention-option').filter({ hasText: 'Editor Demo' }).click();
  await input.pressSequentially('antes de publicar');
  await expect(input).toHaveValue(/@Editor Demo antes de publicar$/);
  await owner.getByTestId('comment-send').click();
  const body = owner.getByTestId('comment-body');
  await expect(body).toContainText('<img src=x onerror="window.__xss=1">');
  await expect(body.locator('span')).toHaveText('@Editor Demo');
  await expect(owner.locator('[data-testid=comments] img')).toHaveCount(0);
  expect(await owner.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

  // O mencionado vê o contador, abre a tela Menções e cai no teste.
  const editor = await (await browser.newContext()).newPage();
  await login(editor, { email: 'editor@abtest.dev', password: 'demo1234' });
  await expect(editor.getByTestId('nav-badge-mentions')).toHaveText('1');
  await nav(editor, 'mentions');
  await expect(editor.getByTestId('mention')).toContainText('Dona Demo mencionou você no teste');
  await expect(editor.getByTestId('nav-badge-mentions')).toHaveCount(0);
  await editor.getByTestId('mention-open').click();
  await expect(editor).toHaveURL(new RegExp(`view=report&id=${id}`));
  await expect(editor.getByTestId('comment')).toHaveCount(1);
  // Editor não exclui comentário de outra pessoa; responde e exclui o próprio.
  await expect(editor.getByTestId('comment-delete')).toHaveCount(0);
  await editor.getByTestId('comment-input').fill('Pode deixar');
  await editor.getByTestId('comment-input').press('Control+Enter');
  await expect(editor.getByTestId('comment')).toHaveCount(2);
  editor.once('dialog', (d) => d.accept());
  await editor.getByTestId('comment-delete').click();
  await expect(editor.getByTestId('comment')).toHaveCount(1);
});
