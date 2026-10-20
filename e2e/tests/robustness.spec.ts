// Robustez da interface: em cada tela do menu, preenche todo campo com entradas erradas (vazio, espaços, texto
// enorme, HTML/script, emoji, número negativo/gigante, URL inválida), dá clique duplo em cada botão e no botão
// principal de cada janela aberta. Falha se houver erro de JavaScript, resposta 5xx da API, script injetado
// executando (XSS) ou o mesmo envio (POST/PUT/PATCH/DELETE idêntico) saindo duas vezes de um clique duplo.
// Roda depois dos outros testes (projeto "robustez" em playwright.config.ts): grava lixo na conta demo.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { EDITOR, login } from '../editor';

const API = 'http://localhost:4000';
// Ações que mudam o estado da conta para todos (ou deslogam): ficam de fora do clique genérico.
const SKIP =
  /excluir|remover|apagar|revogar|publicar|arquivar|sair|desligar|resetar|limpar|pausar|iniciar|encerrar/i;

const TEXTS = [
  '',
  '   ',
  'x'.repeat(5000),
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=1</script>',
  "' OR 1=1 --",
  '😀🚀 ação ção',
  'não é uma url',
];
const NUMBERS = ['-1', '0', '99999999999', '1e999', '0.000001', '-0'];

interface Problems {
  list: string[];
  writes: { at: number; key: string }[];
}

function watch(page: Page): Problems {
  const p: Problems = { list: [], writes: [] };
  page.on('pageerror', (e) => p.list.push(`erro JS: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    // 4xx de validação aparecem como "Failed to load resource"; são esperados.
    if (m.type() === 'error' && !/Failed to load resource|status of 4\d\d/.test(m.text()))
      p.list.push(`console.error: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(API) && r.status() >= 500)
      p.list.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`);
  });
  page.on('request', (r) => {
    if (r.url().startsWith(API) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()))
      p.writes.push({
        at: Date.now(),
        key: `${r.method()} ${r.url().replace(API, '')} ${r.postData() ?? ''}`,
      });
  });
  // alert/confirm/prompt: recusa (não confirma exclusões); aviso de saída com alteração pendente: sai.
  page.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()));
  return p;
}

/** Envios idênticos que saíram mais de uma vez desde `since` (clique duplo que não foi barrado). */
function duplicates(p: Problems, since: number): string[] {
  const seen = new Map<string, number>();
  for (const w of p.writes.filter((w) => w.at >= since)) seen.set(w.key, (seen.get(w.key) ?? 0) + 1);
  return [...seen]
    .filter(([k, n]) => n > 1 && !k.startsWith('POST /collect'))
    .map(([k, n]) => `${n}× ${k.slice(0, 160)}`);
}

/** Preenche cada campo visível com um valor ruim (um por campo, rodando a lista) e dispara blur/change. */
async function fuzzFields(scope: Locator, round: number) {
  const fields = scope.locator(
    'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=color]):not([type=range]):visible:enabled, textarea:visible:enabled',
  );
  const n = Math.min(await fields.count(), 30);
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    const type = (await f.getAttribute('type')) ?? 'text';
    if (['date', 'datetime-local', 'time', 'month', 'week'].includes(type)) continue;
    const pool = type === 'number' ? NUMBERS : TEXTS;
    await f.fill(pool[(i + round) % pool.length]!, { timeout: 2000 }).catch(() => {});
  }
  const selects = scope.locator('select:visible:enabled');
  for (let i = 0; i < Math.min(await selects.count(), 10); i++) {
    const s = selects.nth(i);
    const values = await s
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    if (values.length) await s.selectOption(values[(i + round) % values.length]!).catch(() => {});
  }
}

const label = async (b: Locator) =>
  ((await b.getAttribute('aria-label')) ?? (await b.innerText().catch(() => '')) ?? '').trim().slice(0, 40);

/** Clique duplo e checa envio duplicado. */
async function doubleClick(page: Page, p: Problems, b: Locator, where: string) {
  const since = Date.now();
  await b.dblclick({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  for (const d of duplicates(p, since)) p.list.push(`clique duplo em "${where}" enviou ${d}`);
}

/** Na janela aberta: campos com lixo, clique duplo no botão principal, duas rodadas; depois fecha. */
async function fuzzDialog(page: Page, p: Problems, where: string) {
  const dialog = page.locator('dialog[open]').last();
  for (let round = 0; round < 2; round++) {
    if (!(await dialog.isVisible())) return;
    await fuzzFields(dialog, round);
    const primary = dialog.locator('footer button:enabled, button[type=submit]:enabled').last();
    if (await primary.count()) await doubleClick(page, p, primary, `${where} › ${await label(primary)}`);
  }
  for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()); i++)
    await page.keyboard.press('Escape');
}

async function views(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="nav-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(4)));
}

const open = (page: Page, view: string) => {
  const [screen, type] = view.split(':');
  return page.goto(`${EDITOR}?view=${screen}${type ? `&type=${type}` : ''}`);
};

test('login: campos vazios, e-mail inválido, senha errada e clique duplo', async ({ page }) => {
  const p = watch(page);
  await page.goto(EDITOR);
  const email = page.getByLabel('E-mail');
  const pass = page.getByLabel('Senha');
  const enter = page.getByRole('button', { name: 'Entrar' });
  for (const [e, s] of [
    ['', ''],
    ['   ', '   '],
    ['nao-e-email', 'x'],
    ['demo@abtest.dev', 'errada'],
    ['x'.repeat(5000), 'x'.repeat(5000)],
    ["' OR 1=1 --", "' OR 1=1 --"],
  ]) {
    await email.fill(e!);
    await pass.fill(s!);
    await doubleClick(page, p, enter, 'Entrar');
    await expect(page.getByTestId('user-menu')).toHaveCount(0);
  }
  await email.fill('demo@abtest.dev');
  await pass.fill('demo1234');
  const logins = p.writes.length;
  await enter.dblclick();
  await expect(page.getByTestId('user-menu')).toBeVisible();
  expect(p.writes.slice(logins).filter((w) => w.key.startsWith('POST /auth/login')).length).toBe(1);
  expect(p.list).toEqual([]);
});

test('novo experimento: clique duplo em Criar cria um só', async ({ page }) => {
  const p = watch(page);
  await login(page);
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('create-name').fill(`Duplo ${Date.now()}`);
  const before = p.writes.length;
  await page.getByTestId('create-submit').dblclick();
  await expect(page).toHaveURL(/\?exp=/);
  await page.waitForTimeout(500);
  expect(p.writes.slice(before).filter((w) => w.key.startsWith('POST /experiments ')).length).toBe(1);
  expect(p.list).toEqual([]);
});

// Mesma lista do menu (apps/editor/src/shell.tsx#NAV); o primeiro teste confere que nenhuma ficou de fora.
const VIEWS = [
  'home',
  'tests',
  'tests:personalization',
  'tests:rollout',
  'tests:server',
  'flags',
  'optimize',
  'heatmaps',
  'recordings',
  'forms',
  'funnels',
  'journeys',
  'cohorts',
  'predictive',
  'popups',
  'surveys',
  'recos',
  'events',
  'audiences',
  'profiles',
  'segments',
  'install',
  'integrations',
];

test('a lista de telas cobre o menu inteiro', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  expect((await views(page)).sort()).toEqual([...VIEWS].sort());
});

for (const view of VIEWS)
  test(`tela ${view}: entradas erradas e cliques duplos`, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const p = watch(page);
    await login(page);
    await expect(page.getByTestId('user-menu')).toBeVisible();
    const settle = () => page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await open(page, view);
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await settle();
    await fuzzFields(main, 0);
    const n = Math.min(await main.locator('button:visible:enabled').count(), 25);
    for (let i = 0; i < n; i++) {
      // A tela pode ter mudado (navegou, abriu outra coisa): volta e segue do mesmo índice.
      if (!page.url().includes(`view=${view.split(':')[0]}`) || page.url().includes('exp=')) {
        await open(page, view);
        await settle();
      }
      const b = main.locator('button:visible:enabled').nth(i);
      if (!(await b.count())) break;
      const name = await label(b).catch(() => '');
      if (SKIP.test(name)) continue;
      await doubleClick(page, p, b, `${view} › ${name}`);
      if (await page.locator('dialog[open]').count()) await fuzzDialog(page, p, `${view} › ${name}`);
      await fuzzFields(main, i);
    }
    // A tela continua de pé depois de tudo (sem tela branca).
    await expect(page.locator('main, [data-testid=site-frame]').first()).toBeVisible();
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    expect(p.list).toEqual([]);
  });

test('editor visual e relatório aguentam entradas erradas e cliques duplos', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const p = watch(page);
  await login(page);
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('create-name').fill(`Robustez ${Date.now()}`);
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/\?exp=/);
  const editorUrl = page.url();
  const id = new URL(editorUrl).searchParams.get('exp')!;
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');

  for (const [where, url, scope] of [
    ['editor', editorUrl, 'body'],
    ['relatório', `${EDITOR}?view=report&id=${encodeURIComponent(id)}`, 'main'],
  ] as const) {
    await page.goto(url);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    const root = page.locator(scope);
    await fuzzFields(root, 0);
    const n = Math.min(await root.locator('button:visible:enabled').count(), 40);
    for (let i = 0; i < n; i++) {
      if (page.url() !== url) {
        await page.goto(url);
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      }
      const b = root.locator('button:visible:enabled').nth(i);
      if (!(await b.count())) break;
      const name = await label(b);
      if (SKIP.test(name) || /voltar|início/i.test(name)) continue;
      await doubleClick(page, p, b, `${where} › ${name}`);
      if (await page.locator('dialog[open]').count()) await fuzzDialog(page, p, `${where} › ${name}`);
      await fuzzFields(root, i);
    }
  }
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  expect(p.list).toEqual([]);
});
