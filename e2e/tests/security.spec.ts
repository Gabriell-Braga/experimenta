import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { EDITOR, login, nav } from '../editor';

const API = 'http://localhost:4000';

/** Código TOTP (RFC 6238, SHA-1, 6 dígitos) `offset` passos de 30 s à frente, como o app do celular. */
function totp(secret: string, offset = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/\s/g, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function api<T>(
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const r = await request.fetch(`${API}${path}`, {
    method,
    data: body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(r.ok(), `${method} ${path} → ${r.status()}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** Pessoa nova (convite na conta `token`): ligar duas etapas na demo afetaria os outros testes. */
async function newPerson(request: APIRequestContext, ownerToken: string, role = 'editor') {
  const email = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@x.com`;
  const inv = await api<{ token: string }>(request, 'POST', '/invites', { email, role }, ownerToken);
  await api(request, 'POST', `/auth/invites/${encodeURIComponent(inv.token)}/accept`, {
    name: 'Pessoa Segura',
    password: 'senha-boa-123',
  });
  return { email, password: 'senha-boa-123' };
}

// Segurança de acesso (16.5): duas etapas, sessões ativas e exigência por conta.
test('ativa duas etapas, o login pede o código e "sair de todos os outros" derruba outra sessão', async ({
  page,
  request,
}) => {
  const demo = await api<{ token: string }>(request, 'POST', '/auth/login', {
    email: 'demo@abtest.dev',
    password: 'demo1234',
  });
  const cred = await newPerson(request, demo.token);
  await login(page, cred);
  await nav(page, 'security');
  await expect(page.getByTestId('totp-status')).toHaveText('desativado');
  await page.getByTestId('totp-setup').click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByTestId('totp-enable').click();
  await expect(page.getByText(/Código inválido/)).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByTestId('totp-enable').click();
  const codes = page.getByTestId('recovery-codes').locator('li');
  await expect(codes).toHaveCount(10);
  const recovery = (await codes.first().textContent())!;
  await page.getByTestId('recovery-done').click();
  await expect(page.getByTestId('totp-status')).toHaveText('ativado');
  // O segredo não aparece mais.
  await expect(page.getByTestId('totp-secret')).toHaveCount(0);

  // Outra sessão (pela API, com código de recuperação); "sair de todos os outros" derruba ela.
  const ch = await api<{ challenge: string }>(request, 'POST', '/auth/login', cred);
  const other = await api<{ token: string }>(request, 'POST', '/auth/login/totp', {
    challenge: ch.challenge,
    code: recovery,
  });
  await page.reload();
  await expect(page.getByTestId('session')).toHaveCount(3); // aceite do convite + UI + API
  await expect(page.getByTestId('sessions')).toContainText('esta sessão');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('sessions-revoke-all').click();
  await expect(page.getByTestId('session')).toHaveCount(1);
  expect(
    (await request.get(`${API}/me`, { headers: { authorization: `Bearer ${other.token}` } })).status(),
  ).toBe(401);

  // Sair (encerra a sessão) e entrar de novo: agora pede o código.
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
  // Sair recarrega a página; esperar o formulário evita o goto do login ser abortado por essa navegação.
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await login(page, cred);
  await expect(page.getByTestId('totp-form')).toBeVisible();
  await page.getByLabel('Código').fill('111111');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Código inválido');
  await page.getByLabel('Código').fill(totp(secret, 1)); // o código da ativação já foi usado
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('user-menu')).toBeVisible();
});

test('conta que exige duas etapas: quem não ativou só vê a configuração até ativar', async ({
  page,
  request,
}) => {
  // Conta própria: owner com duas etapas liga a exigência e convida alguém sem.
  const demo = await api<{ token: string }>(request, 'POST', '/auth/login', {
    email: 'demo@abtest.dev',
    password: 'demo1234',
  });
  const ownerCred = await newPerson(request, demo.token);
  const ch = await api<{ token: string }>(request, 'POST', '/auth/login', ownerCred);
  const acc = await api<{ token: string }>(
    request,
    'POST',
    '/accounts',
    { name: 'Loja Segura', siteUrl: 'https://segura.example/' },
    ch.token,
  );
  const { secret } = await api<{ secret: string }>(request, 'POST', '/me/totp/setup', undefined, acc.token);
  await api(request, 'POST', '/me/totp/enable', { code: totp(secret) }, acc.token);
  await api(request, 'PUT', '/account/security', { requireTotp: true }, acc.token);
  const cred = await newPerson(request, acc.token, 'viewer');

  await page.goto(EDITOR);
  await login(page, cred);
  // Entra na conta padrão da pessoa (a do convite, que exige): só a tela de ativação.
  await expect(page.getByTestId('totp-gate')).toBeVisible();
  await expect(page.getByTestId('totp-gate')).toContainText('Loja Segura');
  await page.getByTestId('totp-setup').click();
  const mine = (await page.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  await page.getByLabel('Código de 6 dígitos').fill(totp(mine));
  await page.getByTestId('totp-enable').click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await page.getByTestId('recovery-done').click();
  await expect(page.getByTestId('totp-gate')).toHaveCount(0);
  await expect(page.getByTestId('current-account')).toHaveText('Loja Segura');
});
