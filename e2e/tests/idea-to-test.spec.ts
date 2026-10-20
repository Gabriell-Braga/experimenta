import { expect, test, type APIRequestContext } from '@playwright/test';
import { EDITOR, login, nav } from '../editor';

const API = 'http://localhost:4000';
const SITE = 'http://localhost:5180';
const PAGE = '/spa/planos';

interface Idea {
  id: string;
  title: string;
  page: string;
  change: string;
  hypothesis: string;
  doneAt?: string;
}
interface Ideas {
  status: string;
  ideas: Idea[];
}

/**
 * Ideias reais (por regras, a API do E2E não tem IA): página muito vista, pouco rolada e com rage clicks gera
 * "Subir o CTA e a prova social" e "Tornar clicável o que parece clicável" para ela.
 */
async function seedIdeas(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'demo@abtest.dev', password: 'demo1234' },
  });
  const headers = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` };
  const n = () => `e2e-ideia-${Math.random().toString(36).slice(2, 10)}`;
  const at = (v: string) => ({ ts: Date.now(), accountId: 'demo', visitorId: v, url: `${SITE}${PAGE}` });
  const events = Array.from({ length: 150 }, (_, i) => {
    const v = n();
    return [
      { ...at(v), eventId: n(), type: 'pageview', device: 'desktop', title: 'Planos' },
      {
        ...at(v),
        eventId: n(),
        type: 'scroll',
        depth: 10,
        vh: 720,
        ph: 3000,
        device: 'desktop',
        variations: {},
      },
      ...(i < 20
        ? [
            {
              ...at(v),
              eventId: n(),
              type: 'frustration',
              kind: 'rage',
              selector: 'li',
              rx: 0.5,
              ry: 0.5,
              count: 3,
              device: 'desktop',
              variations: {},
            },
          ]
        : []),
    ];
  }).flat();
  // Lotes pequenos: /collect aceita até 200 eventos e 64 KB por chamada.
  for (let i = 0; i < events.length; i += 60) {
    const r = await request.post(`${API}/collect`, {
      data: JSON.stringify({ events: events.slice(i, i + 60) }),
      headers: { 'content-type': 'text/plain' },
    });
    expect(r.ok()).toBe(true);
  }
  // Outra geração (outro teste) pode estar rodando com dados de antes: tenta até as duas ideias aparecerem.
  for (let round = 0; round < 4; round++) {
    await request.delete(`${API}/ai/ideas`, { headers });
    await request.post(`${API}/ai/ideas?days=7`, { headers });
    let s: Ideas = { status: 'running', ideas: [] };
    for (let i = 0; i < 60 && s.status === 'running'; i++) {
      await new Promise((ok) => setTimeout(ok, 250));
      s = (await (await request.get(`${API}/ai/ideas`, { headers })).json()) as Ideas;
    }
    const mine = (t: string) => s.ideas.find((x) => x.page === PAGE && x.title === t && !x.doneAt);
    const cta = mine('Subir o CTA e a prova social');
    const click = mine('Tornar clicável o que parece clicável');
    if (cta && click) return { cta, click, headers };
  }
  throw new Error('ideias da página não foram geradas');
}

test('ideia → teste em um clique: editor com nome, página, hipótese, meta e pré-visualização da IA', async ({
  page,
  request,
}) => {
  const { cta, click, headers } = await seedIdeas(request);
  await login(page);
  await nav(page, 'optimize');
  const card = (t: string) => page.getByTestId('idea').filter({ hasText: t }).filter({ hasText: PAGE });

  // IA "configurada" só para o navegador: a resposta da criação diz que há IA e o provedor é falso.
  let creates = 0;
  await page.route('**/ai/ideas/*/experiment', async (route) => {
    creates++;
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), ai: true } });
  });
  let prompt = '';
  await page.route('**/ai/variation', async (route) => {
    const body = route.request().postDataJSON() as {
      prompt: string;
      page: { elements: { ref: string; tag: string; text: string }[] };
    };
    prompt = body.prompt;
    const ref = (tag: string, text: string) =>
      body.page.elements.find((e) => e.tag === tag && e.text === text)!.ref;
    await route.fulfill({
      json: {
        changes: [
          { type: 'setText', ref: ref('h1', 'Planos'), value: 'Planos com frete grátis' },
          {
            type: 'setStyle',
            ref: ref('button', 'Assinar'),
            value: { 'background-color': 'rgb(22, 163, 74)' },
          },
        ],
        skipped: 0,
        message: 'Título e botão em destaque.',
        source: 'modelo',
        model: 'falso',
      },
    });
  });

  // Clique duplo: um pedido só, um teste só.
  await card(cta.title).getByTestId('idea-create-test').dblclick();
  await expect(page).toHaveURL(new RegExp(`\\?exp=exp_${cta.id}$`));
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  expect(creates).toBe(1);

  // Aba IA aberta com a mudança da ideia, gerada e pré-visualizada sem entrar na variação.
  await expect(page.getByTestId('ai-seed')).toContainText(cta.title);
  await expect(page.getByTestId('ai-prompt')).toHaveValue(cta.change);
  await expect(page.getByTestId('ai-change')).toHaveText([
    'Texto → “Planos com frete grátis”',
    'Estilo: background-color: rgb(22, 163, 74)',
  ]);
  expect(prompt).toBe(cta.change);
  const site = page.frameLocator('[data-testid=site-frame]');
  await expect(site.locator('h1')).toHaveText('Planos com frete grátis');
  await expect(page.getByTestId('side-changes')).toHaveText('Alterações (0)');
  // Nada aplicado sem aceite: descartar volta o site ao original (aplicar é coberto em ai-variation).
  await page.getByTestId('ai-discard').click();
  await expect(site.locator('h1')).toHaveText('Planos');

  // Nome, hipótese e meta já no teste.
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings').getByRole('textbox').first()).toHaveValue(cta.title);
  await expect(page.getByTestId('hypothesis')).toHaveValue(cta.hypothesis);
  await expect(page.getByTestId('goal')).toHaveCount(1);
  await page.getByTestId('settings-done').click();

  const list = (await (await request.get(`${API}/experiments`, { headers })).json()) as {
    id: string;
    editorUrl: string;
  }[];
  expect(list.filter((e) => e.id === `exp_${cta.id}`)).toEqual([
    expect.objectContaining({ editorUrl: `${SITE}${PAGE}` }),
  ]);

  // Na lista de ideias: executada, com link para o teste.
  await page.goto(`${EDITOR}?view=optimize`);
  await page.getByText(/Executadas/).click();
  await card(cta.title).getByTestId('idea-open-test').click();
  await expect(page).toHaveURL(new RegExp(`\\?exp=exp_${cta.id}$`));
  // Reabrir o teste não gera de novo.
  await expect(page.getByTestId('ai-seed')).toHaveCount(0);

  // Sem IA: abre com a mudança como sugestão no campo, sem gerar nada.
  await page.unroute('**/ai/ideas/*/experiment');
  prompt = '';
  await page.goto(`${EDITOR}?view=optimize`);
  await card(click.title).getByTestId('idea-create-test').click();
  await expect(page).toHaveURL(new RegExp(`\\?exp=exp_${click.id}$`));
  await expect(page.getByTestId('ai-seed')).toContainText('IA não está configurada');
  await expect(page.getByTestId('ai-prompt')).toHaveValue(click.change);
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
  expect(prompt).toBe('');
});
