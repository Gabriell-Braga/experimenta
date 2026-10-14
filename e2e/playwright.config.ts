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
  webServer: [
    {
      // Compila snippet e agent antes: a API copia os bundles para a CDN local ao subir.
      command:
        'pnpm --filter @abtest/snippet build && pnpm --filter @abtest/agent build && pnpm --filter @abtest/api start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      cwd: '..',
      env: { PGLITE_DIR: 'memory://', CDN_DIR: 'e2e/.cdn', EDITOR_ORIGINS: 'http://localhost:5173' },
    },
    {
      command: 'pnpm --filter @abtest/demo dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
});
