# Deploy na Cloudflare

Tudo roda em Workers (conta Cloudflare do projeto, subdomínio `hub-villa-deli.workers.dev`):

| Serviço | URL | O que é |
|---|---|---|
| Editor | https://abtest-editor.hub-villa-deli.workers.dev | app React (arquivos estáticos) |
| API + CDN | https://abtest-api.hub-villa-deli.workers.dev | Worker Hono (`apps/api/src/worker.ts`), D1 `abtest-db`, KV `abtest-cdn`; Swagger em `/docs` |
| Site demo | https://abtest-demo.hub-villa-deli.workers.dev | site de teste com o snippet instalado; `/bloqueado/*` envia XFO/CSP |
| Extensão | https://abtest-editor.hub-villa-deli.workers.dev/abtest-extension.zip | MV3 com a ponte para o editor publicado |

## Comandos
- Deploy completo (bundles do snippet/agent na KV, recompila configs publicadas, migrações D1, API, editor com a extensão, demo): `pnpm deploy:cf` (precisa de `wrangler login`).
- Smoke test em produção: `PROD_PASSWORD=<senha> pnpm --filter @abtest/e2e exec playwright test -c playwright.prod.config.ts`.
- Logs da API: `cd apps/api && pnpm exec wrangler tail`.

## Recursos e segredos (já criados)
- D1 `abtest-db` (schema SQLite em `apps/api/migrations-d1/`, aplicado por `wrangler d1 migrations apply abtest-db --remote`).
- KV `abtest-cdn` (binding `CDN`): `abt.js`, `agent.js`, `<conta>.js`, `<conta>.json`.
- Segredos do Worker: `JWT_SECRET`, `SEED_PASSWORD` (senha dos usuários da conta demo, criados no primeiro acesso). Trocar com `wrangler secret put`.
- Variáveis em `apps/api/wrangler.jsonc`: `PUBLIC_URL`, `EDITOR_ORIGINS`, `DEMO_SITE_URL`, `HEATMAP_SAMPLE_RATE`.

## Para instalar num site real
`<script src="https://abtest-api.hub-villa-deli.workers.dev/cdn/<conta>.js"></script>` como primeiro script do `<head>`.
