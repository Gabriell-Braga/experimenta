# Deploy na Cloudflare

Tudo roda em Workers na conta Cloudflare do projeto, com domínio próprio (zona `gabrielbraga.app`, rotas `custom_domain` em cada `wrangler.jsonc`). Os endereços antigos `*.hub-villa-deli.workers.dev` continuam respondendo (mesmos Workers).

| Serviço | URL | O que é |
|---|---|---|
| Editor | https://experimenta.gabrielbraga.app | app React (arquivos estáticos) |
| API + CDN | https://experimenta-api.gabrielbraga.app | Worker Hono (`apps/api/src/worker.ts`), D1 `abtest-db`, KV `abtest-cdn`; Swagger em `/docs` |
| Site demo | https://experimenta-demo.gabrielbraga.app | loja `/loja/` (raiz redireciona) e SaaS `/saas/` com o snippet instalado; `/bloqueado/*` envia XFO/CSP |
| Extensão | https://experimenta.gabrielbraga.app/abtest-extension.zip | MV3 com a ponte para o editor publicado |

API e demo ficam em `experimenta-api` / `experimenta-demo` (irmãos, não `api.experimenta`): o certificado universal da Cloudflare só cobre um nível (`*.gabrielbraga.app`).

## Comandos
- Deploy completo (bundles do snippet/agent na KV, recompila configs publicadas, migrações D1, API, editor com a extensão, demo): `pnpm deploy:cf` (precisa de `wrangler login`).
- Dados de demonstração em produção (fases 1–19, idempotente): `API_URL=https://experimenta-api.gabrielbraga.app SITE_URL=https://experimenta-demo.gabrielbraga.app EDITOR_ORIGIN=https://experimenta.gabrielbraga.app SEED_PASSWORD=<senha> VISITORS=1500 pnpm seed:data`.
- Smoke test em produção: `PROD_PASSWORD=<senha> pnpm --filter @abtest/e2e exec playwright test -c playwright.prod.config.ts`.
- Logs da API: `cd apps/api && pnpm exec wrangler tail`.

## Recursos e segredos (já criados)
- D1 `abtest-db` (schema SQLite em `apps/api/migrations-d1/`, aplicado por `wrangler d1 migrations apply abtest-db --remote`).
- KV `abtest-cdn` (binding `CDN`): `abt.js`, `agent.js`, `<conta>.js`, `<conta>.json`.
- Segredos do Worker: `JWT_SECRET`, `SEED_PASSWORD` (senha dos usuários da conta demo, criados no primeiro acesso). Trocar com `wrangler secret put`.
- Opcional: `ANTHROPIC_API_KEY` (`wrangler secret put ANTHROPIC_API_KEY`) liga as ideias de teste com Claude em Testes → Otimização por IA; sem ela, as ideias vêm das regras dos insights. No Node, a mesma variável de ambiente.
- Opcional, grátis: modelo compatível com OpenAI no lugar do Claude — `AI_BASE_URL`, `AI_MODEL` e `AI_API_KEY` (quando o provedor pede). Ex.: Gemini (camada grátis, chave em aistudio.google.com) `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai AI_MODEL=gemini-3.5-flash,gemini-3.1-flash-lite AI_REASONING=none` (lista: sobrecarga ou timeout de 15 s passa para o próximo; configurado em produção: vars no wrangler.jsonc, chave no secret `AI_API_KEY`; o 2.5 não está mais disponível para chaves novas); Groq `https://api.groq.com/openai/v1` + `llama-3.3-70b-versatile`; Ollama local `http://localhost:11434/v1` + `qwen2.5:7b` (sem chave). Se o modelo falhar ou responder fora do formato, valem as regras.
- Variáveis em `apps/api/wrangler.jsonc`: `PUBLIC_URL`, `EDITOR_ORIGINS`, `DEMO_SITE_URL`, `HEATMAP_SAMPLE_RATE`.

## Para instalar num site real
`<script src="https://experimenta-api.gabrielbraga.app/cdn/<conta>.js"></script>` como primeiro script do `<head>`.
