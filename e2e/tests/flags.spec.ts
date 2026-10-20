import { expect, test } from '@playwright/test';
import { login, nav } from '../editor';

test('feature flag: cria com rollout, publica e o sdk.json da conta traz a flag', async ({
  page,
  request,
}) => {
  const key = `flag-${Math.random().toString(36).slice(2, 7)}`;
  await login(page);
  await nav(page, 'flags');
  await page.getByTestId('new-flag').click();
  await page.getByTestId('flag-key').fill(key);
  await page.getByTestId('flag-editor').getByRole('switch').click();
  await page.getByTestId('flag-save').click();
  await expect(page.getByTestId('flag-row').filter({ hasText: key })).toBeVisible();
  const sdk = (await (await request.get('http://localhost:4000/cdn/demo.sdk.json')).json()) as {
    flags: { key: string; enabled: boolean }[];
  };
  expect(sdk.flags.find((f) => f.key === key)).toMatchObject({ enabled: true });
  // Exemplo do SDK por linguagem, com a conta do usuário.
  const snippets = page.getByTestId('sdk-snippets');
  await expect(snippets.getByTestId('sdk-code')).toContainText("createClient({ accountId: 'demo'");
  await snippets.getByRole('tab', { name: 'Python' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText('abt = Client("demo"');
  await snippets.getByRole('tab', { name: 'Go' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText('experimenta.New(');
  await snippets.getByRole('tab', { name: 'React Native' }).click();
  await expect(snippets.getByTestId('sdk-code')).toContainText("useFlag('");
  await expect(snippets.getByTestId('sdk-code')).toContainText('<ExperimentaProvider client={abt}>');
  // Desligar pela lista republica.
  await page.getByTestId('flag-row').filter({ hasText: key }).getByRole('switch').click();
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('http://localhost:4000/cdn/demo.sdk.json')).json()) as typeof sdk
        ).flags.find((f) => f.key === key)?.enabled,
    )
    .toBe(false);
});
