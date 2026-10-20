import { expect, test } from '@playwright/test';
import { EDITOR, login, nav } from '../editor';

// Multi-conta (16.2): convite por link, criação de login pelo convite, conta nova e troca de conta.
test('owner convida; convidado cria login, cria conta própria e troca entre as contas', async ({
  page,
  browser,
}) => {
  const email = `p${Date.now().toString(36)}@x.com`;
  await login(page);
  await nav(page, 'team');
  await expect(page.getByTestId('member')).not.toHaveCount(0);
  await expect(page.getByTestId('members')).toContainText('demo@abtest.dev');

  await page.getByLabel('E-mail de quem convidar').fill(email);
  await page.getByLabel('Papel do convite').selectOption('editor');
  await page.getByTestId('invite-create').click();
  const link = (await page.getByTestId('invite-link').locator('code').textContent())!;
  expect(link).toContain('?invite=inv_demo.');
  await expect(page.getByTestId('invites')).toContainText(email);

  // Convidado, em outro navegador: cria o acesso e cai na conta demo como editor.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await expect(guest.getByTestId('invite-form')).toContainText(email);
  await expect(guest.getByTestId('invite-form')).toContainText('Editor');
  await guest.getByLabel('Seu nome').fill('Pessoa Convidada');
  await guest.getByLabel(/^Senha/).fill('senha-boa-123');
  await guest.getByTestId('invite-accept').click();
  await expect(guest.getByTestId('current-account')).toHaveText('Loja Demo');

  // O link é de uso único.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await expect(again.getByRole('heading', { name: 'Convite inválido' })).toBeVisible();

  // Conta nova: entra nela como owner, vazia, só com a própria pessoa na equipe.
  await guest.getByTestId('user-menu').click();
  await guest.getByTestId('new-account').click();
  await guest.getByLabel('Nome da conta').fill('Loja da Convidada');
  await guest.getByLabel('Endereço do site').fill('https://convidada.example/');
  await guest.getByRole('button', { name: 'Criar conta' }).click();
  await expect(guest.getByTestId('current-account')).toHaveText('Loja da Convidada');
  await nav(guest, 'team');
  await expect(guest.getByTestId('member')).toHaveCount(1);
  await expect(guest.getByTestId('invite-create')).toBeVisible(); // owner da conta nova

  // Troca de volta pela lista de contas do menu.
  await guest.getByTestId('user-menu').click();
  await guest.getByTestId('account-list').getByRole('menuitemradio', { name: 'Loja Demo' }).click();
  await expect(guest.getByTestId('current-account')).toHaveText('Loja Demo');
  await nav(guest, 'team');
  await expect(guest.getByTestId('invite-create')).toHaveCount(0); // editor aqui: não convida

  // Owner remove a pessoa da demo; ela continua com a conta própria.
  await page.reload();
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remover Pessoa Convidada' }).click();
  await expect(page.getByTestId('members')).not.toContainText(email);
  // Removida, a sessão na demo cai; o login leva para a conta que sobrou.
  await guest.goto(EDITOR);
  await login(guest, { email, password: 'senha-boa-123' });
  await expect(guest.getByTestId('current-account')).toHaveText('Loja da Convidada');
});
