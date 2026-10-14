# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **REGRA: Ao iniciar qualquer sessão, leia docs/PROGRESSO.md e docs/PLANO.md e continue da próxima tarefa não concluída.**
>
> Ciclo por tarefa: marcar "em andamento" em PROGRESSO.md (hora real via `date "+%Y-%m-%d %H:%M"`) → implementar + testes → `pnpm test` e `pnpm lint` passando → marcar `- [x]` em PLANO.md, histórico em PROGRESSO.md, decisões em docs/DECISOES.md → commit `fase N: descrição`. Seguir sem pedir aprovação.

## O que é
Editor visual de testes A/B (substituto do VWO), futuro SaaS multi-tenant. O site do cliente roda num iframe dentro do app do editor; nosso snippet no site detecta o modo edição e carrega o editor agent, que conversa com o app via RPC tipado sobre postMessage. Alterações são salvas como lista de operações (nunca HTML); publicar compila um JSON por conta servido por CDN.

## Arquitetura (alvo — ver docs/PLANO.md)
- `packages/shared` — schemas zod (operações, experimentos, protocolo RPC, eventos). Fonte única de tipos.
- `packages/selector` — geração/resolução de seletores + impressão digital (fallback "seletor curado").
- `packages/snippet` — runtime do site do cliente, vanilla TS sem deps, < 10 KB gzip.
- `packages/agent` — editor agent, UI em Shadow DOM, só carregado no modo edição.
- `apps/editor` (React+Vite+Tailwind+Monaco), `apps/api` (Hono+Drizzle+Postgres), `apps/extension` (Chrome MV3), `apps/demo` (sites de teste).

## Comandos
pnpm 9 (instalado via `npm i -g pnpm@9`). Turborepo orquestra os scripts dos workspaces.
- `pnpm install` — dependências.
- `pnpm test` — Vitest em todos os workspaces. Um pacote: `pnpm --filter @abtest/shared test`. Um teste: `pnpm --filter @abtest/shared exec vitest run src/arquivo.test.ts -t "nome"`.
- `pnpm lint` — ESLint (flat config na raiz) + `prettier --check`. `pnpm format` corrige formatação.
- `pnpm typecheck` — `tsc --noEmit` por workspace.
- `pnpm build` / `pnpm dev`.

Pacotes internos exportam `src/index.ts` direto (sem build) — Vite/esbuild/Vitest resolvem TS; só bundles finais (snippet, agent, apps) têm build.

## Convenções
- TypeScript estrito. Toda tabela/consulta da API filtra por `account_id`.
- Docs e mensagens de commit em português.
