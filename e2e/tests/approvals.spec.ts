import { expect, test, type Browser, type APIRequestContext } from '@playwright/test';
import { EDITOR, nav } from '../editor';

const API = 'http://localhost:4000';

// Fluxo de aprovação (16.4). Conta própria do teste: ligar a aprovação na demo afetaria os outros testes.
async function setup(request: APIRequestContext) {
  const post = async (path: string, body: unknown, token?: string) => {
    const r = await request.post(`${API}${path}`, {
      data: body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    expect(r.ok(), `${path} → ${r.status()}`).toBe(true);
    return (await r.json()) as { token: string };
  };
  const demo = await post('/auth/login', { email: 'demo@abtest.dev', password: 'demo1234' });
  const owner = await post(
    '/accounts',
    { name: 'Loja com aprovação', siteUrl: 'https://aprovacao.example/' },
    demo.token,
  );
  const s = await request.put(`${API}/account/settings`, {
    data: { heatmapSampleRate: null, requireApproval: true },
    headers: { authorization: `Bearer ${owner.token}` },
  });
  expect(s.ok()).toBe(true);
  const email = `ed${Date.now().toString(36)}@x.com`;
  const inv = await post('/invites', { email, role: 'editor', canPublishJs: false }, owner.token);
  const editor = await post(`/auth/invites/${encodeURIComponent(inv.token)}/accept`, {
    name: 'Edna Editora',
    password: 'senha-boa-123',
  });
  return { owner: owner.token, editor: editor.token };
}

async function as(browser: Browser, token: string) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('abt-token', t), token);
  const page = await ctx.newPage();
  await page.goto(EDITOR);
  await expect(page.getByTestId('user-menu')).toBeVisible();
  return page;
}

test('editor pede, owner recusa com comentário e depois aprova; contadores no menu', async ({
  browser,
  request,
}) => {
  const tokens = await setup(request);
  const ed = await as(browser, tokens.editor);
  const publishConsent = async () => {
    await nav(ed, 'privacy');
    await ed.getByRole('switch', { name: 'Esperar consentimento' }).click();
    await ed.getByTestId('consent-save').click();
    await expect(ed.getByTestId('notice').last()).toContainText('Enviado para aprovação');
  };
  await publishConsent();

  await nav(ed, 'approvals');
  await expect(ed.getByTestId('approval-mode')).toHaveText('Publicação exige aprovação');
  await expect(ed.getByTestId('approval-pending')).toContainText('Edna Editora');
  await expect(ed.getByTestId('approval-approve')).toHaveCount(0); // editor não aprova
  await ed.getByLabel('Recado para quem aprova').fill('Liga o consentimento antes da campanha');
  await ed.getByTestId('approval-request').click();
  await expect(ed.getByTestId('approval-pending')).toHaveCount(1); // mesmo pedido, com recado
  await expect(ed.getByTestId('approval-pending')).toContainText('Liga o consentimento');

  const owner = await as(browser, tokens.owner);
  await expect(owner.getByTestId('nav-badge-approvals')).toHaveText('1');
  await nav(owner, 'approvals');
  await owner.getByTestId('approval-reject').click();
  await expect(owner.getByTestId('toast-error')).toContainText('o que precisa mudar');
  await owner.getByLabel('Comentário para Edna Editora').fill('Falta escolher o banner');
  await owner.getByTestId('approval-reject').click();
  await expect(owner.getByTestId('approval-decided')).toContainText('Falta escolher o banner');
  await expect(owner.getByTestId('approval-empty')).toBeVisible();
  await expect(owner.getByTestId('nav-badge-approvals')).toHaveCount(0);

  // Quem pediu vê a resposta pelo contador; abrir a tela zera.
  await nav(ed, 'privacy');
  await ed.reload();
  await expect(ed.getByTestId('nav-badge-approvals')).toHaveText('1');
  await nav(ed, 'approvals');
  await expect(ed.getByTestId('approval-decided')).toContainText('Recusado');
  await expect(ed.getByTestId('nav-badge-approvals')).toHaveCount(0);

  // Pede de novo (pelo Publicar da tela) e o owner aprova: vai ao ar.
  await publishConsent();
  await owner.reload();
  await expect(owner.getByTestId('approval-pending')).toHaveCount(1);
  await owner.getByTestId('approval-approve').click();
  await expect(owner.getByTestId('notice').last()).toContainText('Aprovado e publicado');
  await expect(owner.getByTestId('approval-decided').first()).toContainText('aprovado por');

  await nav(owner, 'activity');
  await expect(owner.getByTestId('activities')).toContainText('aprovou a publicação pedida por Edna Editora');
  await expect(owner.getByTestId('activities')).toContainText('Edna Editora pediu aprovação para publicar');
});
