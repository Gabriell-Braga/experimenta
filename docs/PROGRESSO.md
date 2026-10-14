# Progresso
**Status:** em andamento
**Fase atual:** 1 — Motor de operações e seletores
**Tarefa atual:** 1.1 — Geração de seletores com prioridades e detecção de classes geradas
**Última atualização:** 2026-10-14 03:42
**Próximo passo:** Criar packages/selector: isGeneratedToken(), generateSelector(el) com prioridade id estável → data-* → classes estáveis → caminho curto ancorado → nth-of-type; alternates; fragilidade; testes em jsdom/happy-dom.

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

### 2026-10-14 03:42 — Tarefa 0.4 concluída
- O que foi feito: schemas zod de operações (11 tipos), alvo/impressão digital, experimento, segmentação, metas, variações (customCSS/JS, redirect), anti-flicker, config publicada, eventos de tracking. 18 testes.
- Arquivos principais: packages/shared/src/{operations,experiment,config,events}.ts
- Como testar manualmente: pnpm --filter @abtest/shared test
- Observações: protocolo RPC entra na tarefa 3.1. Ver D-004.
