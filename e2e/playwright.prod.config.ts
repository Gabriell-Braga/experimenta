import { defineConfig, devices } from '@playwright/test';

// Smoke test contra o deploy na Cloudflare (sem servidores locais).
// PROD_PASSWORD=... (PROD_EDITOR / PROD_DEMO trocam os endereços) pnpm --filter @abtest/e2e exec playwright test -c playwright.prod.config.ts
export default defineConfig({
  testDir: './prod',
  timeout: 90_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'] },
});
