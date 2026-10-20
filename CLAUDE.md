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

## Editor (apps/editor)
Estado = `useReducer` em `src/store.ts` (experimento + histórico desfazer/refazer; a lista de operações da variação ativa é a fonte da verdade). Agent só manda rascunhos (`operation`) → app adiciona → reenvia `applyVariation` com a lista completa. A cada `ready` (nova página no iframe) o app reenvia modo e variação (`src/App.tsx`). Conexão: `src/connection.ts`. Login + lista de experimentos em `src/App.tsx` (`?exp=<id>` abre o editor `src/EditorView.tsx`); persistência via API (`src/api.ts`, token no localStorage).

## Modo edição (handshake)
1. App (logado) cria sessão: `POST /edit-sessions` (CORS só para `EDITOR_ORIGINS`, conta do JWT) → token de 15 min (memória, `apps/api/src/sessions.ts`).
2. App abre o site em iframe com `?abt_edit=<token>`. Snippet (`packages/snippet/src/editor.ts`) só entra em modo edição dentro de iframe: valida o token em `GET /edit-sessions/:token` (conta precisa bater), envia `hello` com targetOrigin = origin do app, e só aceita `hello-ack` do `window.parent` vindo desse origin com o mesmo token. Então carrega `agent.js` (mesma pasta do script da conta) com `window.__ABT_AGENT__`.
3. Agent e app conversam via `createPeer` (`packages/shared/src/rpc-peer.ts`). No modo edição o snippet NÃO aplica experimentos.

## Comandos
pnpm 9 (instalado via `npm i -g pnpm@9`). Turborepo orquestra os scripts dos workspaces.
- `pnpm install` — dependências.
- `pnpm test` — Vitest em todos os workspaces. Um pacote: `pnpm --filter @abtest/shared test`. Um teste: `pnpm --filter @abtest/shared exec vitest run src/arquivo.test.ts -t "nome"`.
- `pnpm lint` — ESLint (flat config na raiz) + `prettier --check`. `pnpm format` corrige formatação.
- `pnpm typecheck` — `tsc --noEmit` por workspace.
- `pnpm dev` — `scripts/dev.mjs`: sobe Postgres via `docker compose` se houver Docker (senão API usa PGlite em `.data/pglite`, ver D-001) e roda `turbo dev`. Portas: editor 5173, API 4000 (serve também `/cdn/:arquivo` da pasta `cdn/`, recompilando as configs com o runtime atual ao subir), demo 5180 (`/` HTML estático, `/spa/*` SPA React com emotion).
- `pnpm build`. Snippet: `pnpm --filter @abtest/snippet build` → `packages/snippet/dist/abt.js` (imprime tamanho gzip).
- `pnpm e2e` — Playwright (`e2e/`); sobe API (PGlite em memória, CDN em `e2e/.cdn`) e demo, compilando snippet e agent antes. Páginas "host" de teste são servidas por `page.route` (Chrome roda com `LocalNetworkAccessChecks` desligado). Um teste: `pnpm --filter @abtest/e2e e2e tests/antiflicker.spec.ts -g "nome"`. Chromium: `pnpm --filter @abtest/e2e exec playwright install chromium`.

Snippet no site: `<script src="http://localhost:4000/cdn/<conta>.js">` como primeiro script do `<head>`; o arquivo = `window.__ABT_CONFIG__={...};` + runtime (D-008). Nos testes E2E o Playwright intercepta essa URL (`e2e/helpers.ts#serveSnippet`).

Pacotes internos exportam `src/index.ts` direto (sem build) — Vite/esbuild/Vitest resolvem TS; só bundles finais (snippet, agent, apps) têm build.

## API (apps/api)
Hono + `@hono/zod-openapi` (`src/app.ts`): OpenAPI em `/openapi.json`, Swagger em `/docs`. Auth: `POST /auth/login` → JWT HS256 (12 h, `JWT_SECRET`); middleware recarrega o usuário a cada requisição; conta SEMPRE vem do token. Multi-conta: `users` é a pessoa (login), papel por conta em `memberships`; o JWT carrega a conta ativa (troca: `POST /accounts/:id/switch`; convites por link `inv_<conta>.<segredo>`, `src/routes/team.ts`). Papéis: viewer (lê), editor (salva), owner; publicar customJS exige owner ou `can_publish_js`. Seed de dev (`src/seed.ts`, conta `demo`): demo@abtest.dev (owner), editor@abtest.dev, viewer@abtest.dev — senha `demo1234`.

## Extensão (apps/extension)
MV3, fallback para sites que bloqueiam iframe ou não têm snippet. `pnpm --filter @abtest/extension build` → `apps/extension/dist` (carregar sem compactação; `EDITOR_ORIGINS` define onde a ponte é injetada). Regras DNR só na aba do editor + sub_frame + origin do site (`src/session.ts`). O editor tenta a extensão após 5 s sem `hello`. Demo `/bloqueado/*` envia XFO DENY + CSP frame-ancestors. E2E carrega a extensão com `chromium.launchPersistentContext` (`e2e/tests/extension.spec.ts`).

## Deploy (Cloudflare)
Ver docs/DEPLOY.md. `pnpm deploy:cf` publica API (Worker `src/worker.ts` + D1 + KV), editor e demo (Workers com assets). Repositório tem duas implementações do mesmo contrato: `src/repo.ts` (Postgres/Drizzle, Node) e `src/repo-d1.ts` (SQLite/D1, schema em `migrations-d1/`) — mudou um, mude o outro; `pnpm --filter @abtest/api test` roda a suíte contra os dois. Código da API que roda no Worker não pode importar `node:*` (Web Crypto em `src/crypto.ts`; fs só em `src/cdn-fs.ts`/`src/server.ts`).

## Banco (apps/api)
Schema Drizzle em `apps/api/src/schema.ts`; migrações SQL em `apps/api/drizzle/` (gerar com `pnpm --filter @abtest/api db:generate` após mudar o schema) aplicadas automaticamente em `createDb` (PGlite ou Postgres). Acesso só via `createRepo` (`src/repo.ts`): toda função recebe `accountId` e filtra por ele.

## Convenções
- TypeScript estrito. Toda tabela/consulta da API filtra por `account_id`.
- Docs e mensagens de commit em português.
