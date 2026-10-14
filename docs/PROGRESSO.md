# Progresso
**Status:** em andamento
**Fase atual:** 0 — Fundação
**Tarefa atual:** 0.4 — packages/shared com schemas zod e testes
**Última atualização:** 2026-10-14 03:41
**Próximo passo:** Escrever schemas zod em packages/shared: Operation (todos os tipos), Target (selector, alternates, fingerprint), Variation, Experiment, Goal, Segmentation, PublishedConfig, eventos de tracking, mensagens RPC; testes.

## Bloqueios / perguntas para os humanos
- (vazio)

## Histórico
### 2026-10-14 03:34 — Seção 1.1 (setup) concluída
- O que foi feito: git init, docs/PLANO.md, docs/PROGRESSO.md, docs/DECISOES.md, CLAUDE.md.
- Arquivos principais: docs/*, CLAUDE.md
- Como testar manualmente: n/a
- Observações: máquina sem Docker; ver DECISOES.md (D-001).

### 2026-10-14 03:36 — Tarefa 0.1 concluída
- O que foi feito: pnpm workspaces, Turborepo, tsconfig.base estrito, ESLint flat + typescript-eslint, Prettier, Vitest; packages/shared esqueleto.
- Arquivos principais: package.json, turbo.json, tsconfig.base.json, eslint.config.js, .prettierrc.json
- Como testar manualmente: pnpm install && pnpm lint && pnpm test && pnpm typecheck
- Observações: pacotes internos exportam src/*.ts direto (sem build).

### 2026-10-14 03:39 — Tarefa 0.2 concluída
- O que foi feito: docker-compose.yml (Postgres 16), scripts/dev.mjs (fallback PGlite), apps/api mínimo Hono com /health e createDb (postgres-js ou PGlite).
- Arquivos principais: docker-compose.yml, scripts/dev.mjs, apps/api/src/{db,app,server}.ts
- Como testar manualmente: pnpm dev; curl localhost:4000/health → {"ok":true}
- Observações: PGlite permite só um processo por dataDir.

### 2026-10-14 03:41 — Tarefa 0.3 concluída
- O que foi feito: apps/demo com Vite multi-page: index.html (ids estáveis, data-testid, id gerado a8f3c91e, lista p/ nth-of-type, img, form, banner que aparece após 800 ms), produto.html, obrigado.html, SPA React em /spa/ (rotas /, /planos, /sobre, classes emotion css-*).
- Arquivos principais: apps/demo/{index,produto,obrigado}.html, apps/demo/src/spa/App.tsx, apps/demo/vite.config.ts
- Como testar manualmente: pnpm --filter @abtest/demo dev; abrir http://localhost:5180 e http://localhost:5180/spa/planos
- Observações: fallback de rota da SPA via plugin no dev server.
