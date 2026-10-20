import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openEditor } from '../editor';
import { makeConfig, serveSnippet } from '../helpers';

const API = 'http://localhost:4000';
const DEMO = 'http://localhost:5180';

// Link de pré-visualização (17.3): rascunho de uma variação no site real, sem publicar, até expirar/revogar.
// Nada publicado no site: a config servida não tem experimento nenhum.
const nothingPublished = () => makeConfig([], { apiUrl: API, trackingUrl: `${API}/collect` });
const badge = (page: Page) => page.locator('[data-abt-qa]');

async function api(request: APIRequestContext) {
  const r = await request.post(`${API}/auth/login`, {
    data: { email: 'demo@abtest.dev', password: 'demo1234' },
  });
  const { token } = (await r.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  return {
    async send<T>(method: 'post' | 'delete', path: string, data?: unknown): Promise<T> {
      const res = await request[method](`${API}${path}`, { data, headers });
      expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBe(true);
      return (res.status() === 204 ? null : await res.json()) as T;
    },
    async projectId() {
      const res = await request.get(`${API}/projects`, { headers });
      return ((await res.json()) as { id: string }[])[0]!.id;
    },
  };
}

test('editor: cria o link do rascunho, o site mostra sem publicar; revogado volta ao original', async ({
  page,
  browser,
}) => {
  const site = await openEditor(page);
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Título do rascunho');
  await page.keyboard.press('Enter');

  await page.getByTestId('open-preview-links').click();
  await page.getByTestId('preview-hours').selectOption('1');
  await page.getByTestId('preview-create').click(); // salva antes (havia alteração)
  const url = await page.getByTestId('preview-url').inputValue();
  expect(url).toContain('abt_preview=');
  await expect(page.getByTestId('preview-list').locator('li')).toHaveCount(1);

  // Outra pessoa (outro navegador) abre o link.
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await serveSnippet(visitor, nothingPublished());
  const collected: string[] = [];
  visitor.on('request', (r) => r.url().includes('/collect') && collected.push(r.url()));
  await visitor.goto(url);
  await expect(visitor.locator('#hero-title')).toHaveText('Título do rascunho');
  await expect(badge(visitor)).toHaveCount(1);
  await expect(visitor).toHaveURL(`${DEMO}/`); // token sai da barra de endereço (fica na sessão)
  // Navegação continua no modo pré-visualização (token na sessão), sem o parâmetro na URL.
  await visitor.getByTestId('cta-comprar').click();
  await expect(visitor).toHaveURL(`${DEMO}/produto.html`);
  await expect(visitor.locator('html')).toHaveAttribute('data-abt-preview', '');
  await visitor.goBack();
  await expect(visitor.locator('#hero-title')).toHaveText('Título do rascunho');
  expect(collected).toEqual([]); // pré-visualização não entra nos relatórios

  // Sem o link (visitante comum), o site segue original: nada foi publicado.
  const other = await (await browser.newContext()).newPage();
  await serveSnippet(other, nothingPublished());
  await other.goto(`${DEMO}/`);
  await expect(other.locator('#hero-title')).toHaveText('O melhor tênis para correr');

  // Revogado: na próxima página o link para de valer e a sessão sai do modo pré-visualização.
  await page.getByTestId('preview-revoke').click();
  await expect(page.getByTestId('preview-list')).toHaveCount(0);
  await visitor.reload();
  await expect(badge(visitor)).toContainText('expirado ou revogado');
  await expect(visitor.locator('#hero-title')).toHaveText('O melhor tênis para correr');
  await visitor.goto(`${DEMO}/`);
  await expect(visitor.locator('html')).not.toHaveAttribute('data-abt-preview', '');
  await ctx.close();
});

test('multipágina: o link segue o funil do rascunho; token errado não mostra nada', async ({
  page,
  request,
}) => {
  const a = await api(request);
  const id = `e_prev_${Date.now().toString(36)}`;
  const op = (opId: string, selector: string, value: string, pg: string) => ({
    id: opId,
    order: 0,
    type: 'setText',
    target: { selector },
    value,
    page: pg,
  });
  await a.send('post', '/experiments', {
    projectId: await a.projectId(),
    editorUrl: `${DEMO}/`,
    experiment: {
      id,
      key: id.replace(/_/g, '-'),
      name: 'Funil em rascunho',
      status: 'draft',
      pages: [
        { id: 'p1', name: 'Home', url: `${DEMO}/`, match: { match: 'exact', value: `${DEMO}/` } },
        {
          id: 'p2',
          name: 'Produto',
          url: `${DEMO}/produto.html`,
          match: { match: 'contains', value: '/produto' },
        },
      ],
      variations: [
        { id: `${id}_v0`, key: 'controle', name: 'Controle', weight: 50 },
        {
          id: `${id}_v1`,
          key: 'b',
          name: 'B',
          weight: 50,
          operations: [
            op('o1', '#hero-title', 'Home rascunho', 'p1'),
            op('o2', '.product-title', 'Produto rascunho', 'p2'),
          ],
        },
      ],
    },
  });
  const link = await a.send<{ token: string; url: string }>('post', `/experiments/${id}/previews`, {
    variationId: `${id}_v1`,
    hours: 1,
  });
  expect(link.url).toBe(`${DEMO}/?abt_preview=${encodeURIComponent(link.token)}`);

  await serveSnippet(page, nothingPublished());
  // Token adulterado: nada aplicado.
  await page.goto(`${DEMO}/?abt_preview=${encodeURIComponent(link.token.split('.')[0]!)}.errado`);
  await expect(badge(page)).toContainText('expirado ou revogado');
  await expect(page.locator('#hero-title')).toHaveText('O melhor tênis para correr');

  await page.goto(link.url);
  await expect(page.locator('#hero-title')).toHaveText('Home rascunho');
  await page.getByTestId('cta-comprar').click();
  await expect(page.locator('.product-title')).toHaveText('Produto rascunho');
  await expect(badge(page)).toContainText('Funil em rascunho → B');
});
