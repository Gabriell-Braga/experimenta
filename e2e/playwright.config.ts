import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5180' },
  webServer: [
    {
      command: 'pnpm --filter @abtest/demo dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
});
