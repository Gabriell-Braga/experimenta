# Progresso
**Status:** em andamento
**Fase atual:** 0 — Fundação
**Tarefa atual:** 0.2 — docker-compose (Postgres) e pnpm dev
**Última atualização:** 2026-10-14 03:36
**Próximo passo:** Criar docker-compose.yml (Postgres 16), apps/api mínimo (Hono) com PGlite fallback, script dev; pnpm dev sobe tudo.

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
