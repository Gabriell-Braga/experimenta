import { defineConfig, devices } from '@playwright/test';

// Smoke test contra o deploy na Cloudflare (sem servidores locais).
// PROD_SUB=hub-villa-deli PROD_PASSWORD=... pnpm --filter @abtest/e2e exec playwright test -c playwright.prod.config.ts
export default defineConfig({
  testDir: './prod',
  timeout: 90_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'] },
});
