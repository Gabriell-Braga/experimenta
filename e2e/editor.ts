import { expect, type Page } from '@playwright/test';

export const EDITOR = 'http://localhost:5173/';
export const OWNER = { email: 'demo@abtest.dev', password: 'demo1234' };

export async function login(page: Page, cred = OWNER) {
  await page.goto(EDITOR);
  await page.getByLabel('E-mail').fill(cred.email);
  await page.getByLabel('Senha', { exact: true }).fill(cred.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Loga no editor, cria um experimento novo e espera o agent conectar. Devolve o iframe do site. */
export async function openEditor(page: Page) {
  await login(page);
  await createExperiment(page);
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  return page.frameLocator('[data-testid=site-frame]');
}

/** Na lista: abre o modal "Novo experimento", dá um nome e cria (página = site do projeto). */
export async function createExperiment(page: Page, name = `Teste ${Math.random().toString(36).slice(2, 7)}`) {
  await page.getByTestId('new-experiment').click();
  await page.getByTestId('create-name').fill(name);
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/\?exp=/);
}

/** Clica num item do menu lateral, abrindo o grupo dele antes se estiver recolhido. */
export async function nav(page: Page, view: string) {
  const header = page.locator(`[data-nav-group]:has([data-testid="nav-${view}"]) > button[aria-expanded]`);
  // Espera o menu existir antes de decidir; grupo de um item só não tem cabeçalho.
  await page.getByTestId(`nav-${view}`).waitFor({ state: 'attached' });
  if ((await header.count()) && (await header.getAttribute('aria-expanded')) === 'false')
    await header.click();
  await page.getByTestId(`nav-${view}`).click();
}
