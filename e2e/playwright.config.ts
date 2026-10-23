import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5180',
    // Páginas servidas via page.route() ficam em espaço de endereço "unknown" e o Chrome bloquearia
    // chamadas a localhost (Local Network Access). Em uso real o editor é servido por um servidor de verdade.
    launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessForWorkers'] },
  },
  // Robustez grava lixo na conta demo: roda só depois de todos os outros.
  projects: [
    { name: 'funcional', testIgnore: /robustness.spec.ts/ },
    {
      name: 'robustez',
      testMatch: /robustness.spec.ts/,
      dependencies: ['funcional'],
      // Botão que some num re-render não pode prender o teste até o limite.
      use: { actionTimeout: 5000 },
    },
  ],
  webServer: [
    {
      // Compila snippet e agent antes: a API copia os bundles para a CDN local ao subir.
      command:
        'node e2e/reset-cdn.mjs && pnpm --filter @abtest/snippet build && pnpm --filter @abtest/agent build && pnpm --filter @abtest/insights build && pnpm --filter @abtest/engage build && pnpm --filter @abtest/extension build && pnpm --filter @abtest/api start',
      url: 'http://localhost:4000/health',
      // Nunca reaproveita a API do `pnpm dev`: os testes (principalmente os de robustez) gravariam no banco de dev.
      // Com o dev ligado na porta 4000 o E2E falha logo, em vez de sujar dados.
      reuseExistingServer: false,
      cwd: '..',
      // DEMO_CONSENT=0: as páginas de teste do demo não têm banner de consentimento (D-099).
      env: {
        PGLITE_DIR: 'memory://',
        CDN_DIR: 'e2e/.cdn',
        EDITOR_ORIGINS: 'http://localhost:5173',
        DEMO_CONSENT: '0',
      },
    },
    {
      command: 'pnpm --filter @abtest/editor dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
    },
    {
      command: 'pnpm --filter @abtest/demo dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
});
