# Progresso
**Status:** em andamento
**Fase atual:** 2 — Snippet de runtime
**Tarefa atual:** 2.6 — Medir e registrar o tamanho gzip em PROGRESSO.md
**Última atualização:** 2026-10-14 04:02
**Próximo passo:** Adicionar checagem de tamanho no build (falha se > 10 KB gzip), registrar tamanho em PROGRESSO.md e fechar fase 2 com resumo.

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

### Resumo da Fase 0 — Fundação
- Entregue: monorepo pnpm + Turborepo + TS estrito + ESLint/Prettier + Vitest; docker-compose com fallback PGlite; API mínima (/health); demo estático + SPA React (emotion); contrato zod em packages/shared.
- Limitações: Docker não testado nesta máquina (sem Docker); `pnpm dev` validado via PGlite.
- Como testar: `pnpm install && pnpm lint && pnpm test && pnpm dev` (API :4000, demo :5180).

### 2026-10-14 03:44 — Tarefa 1.1 concluída
- O que foi feito: isGeneratedToken/isStableClass (CSS-in-JS, CSS Modules, hashes, uuid, ids de framework, classes de estado); generateSelector com prioridade id → data-* → atributos semânticos → classes → caminho ancorado → nth-of-type, alternates e fragilidade.
- Arquivos principais: packages/selector/src/{stability,generate}.ts
- Como testar manualmente: pnpm --filter @abtest/selector test
- Observações: todo seletor gerado é validado como único no documento.

### 2026-10-14 03:46 — Tarefa 1.2 concluída
- O que foi feito: fingerprint(el); resolveTarget (principal → alternativos → impressão digital) com via e seletor curado; findByFingerprint com limiar e margem.
- Arquivos principais: packages/selector/src/{fingerprint,resolve}.ts
- Como testar manualmente: pnpm --filter @abtest/selector test
- Observações: ver D-005.

### 2026-10-14 03:49 — Tarefa 1.3 concluída
- O que foi feito: applyToElement (11 tipos, cada um com undo), applyOperations com ordem, WeakSet global por operação, espera via MutationObserver, timeout a partir do DOMContentLoaded, callbacks onApplied/onFailed, revert.
- Arquivos principais: packages/snippet/src/engine/{operations,apply}.ts
- Como testar manualmente: pnpm --filter @abtest/snippet test
- Observações: ver D-006.

### 2026-10-14 03:50 — Tarefa 1.4 concluída
- O que foi feito: modo persist (reaplica em nós recriados por re-render) e testes de DOM mutável: lotes, âncora tardia, re-render com/sem persist, cura por impressão digital, stop, revert após re-render.
- Arquivos principais: packages/snippet/src/engine/{apply.ts,dom-changes.test.ts,apply.test.ts}
- Como testar manualmente: pnpm --filter @abtest/snippet test
- Observações: ver D-007.

### Resumo da Fase 1 — Motor de operações e seletores
- Entregue: packages/selector (geração com prioridades + detecção de tokens gerados, impressão digital, resolução com cura) e motor em packages/snippet/src/engine (11 tipos de operação com undo, ordem, idempotência, espera por MutationObserver, modo persist, revert).
- Limitações: cura por impressão digital usa heurística simples (D-005); persist não detecta re-render que mantém o mesmo nó (D-007).
- Como testar: `pnpm --filter @abtest/selector test` e `pnpm --filter @abtest/snippet test`.

### 2026-10-14 03:52 — Tarefa 2.1 concluída
- O que foi feito: getVisitor (cookie first-party _abt_vid + fallback localStorage, novo/recorrente via sessionStorage), detectDevice, isBot, matchUrl/matchSegmentation (URL exata/contém/regex com exclusão, dispositivo, query, novo/recorrente), readConfig.
- Arquivos principais: packages/snippet/src/{env,segment,config}.ts
- Como testar manualmente: pnpm --filter @abtest/snippet test
- Observações: config embutida no JS da conta, ver D-008.

### 2026-10-14 03:53 — Tarefa 2.2 concluída
- O que foi feito: murmurhash3 x86_32 (vetores de referência), chooseVariation com tráfego e pesos, assign com persistência. Testes: 10.000 visitantes ~50/50, 20/30/50, tráfego 30%, consistência, independência entre experimentos.
- Arquivos principais: packages/snippet/src/bucket.ts
- Como testar manualmente: pnpm --filter @abtest/snippet exec vitest run src/bucket.test.ts
- Observações: ver D-009.

### 2026-10-14 03:57 — Tarefa 2.3 concluída
- O que foi feito: antiflicker.ts (por elemento e página, timeout), runtime.ts (bots, visitante, segmentação, bucketing, redirect, customCSS/JS, applyOperations persist, eventos exposure/selector_failed/selector_healed via sink), main.ts + build esbuild, snippet no head das páginas demo, pacote e2e com Playwright.
- Arquivos principais: packages/snippet/src/{antiflicker,runtime,main}.ts, packages/snippet/build.mjs, e2e/
- Como testar manualmente: pnpm e2e; ou pnpm --filter @abtest/snippet build e abrir o demo com um /cdn/demo.js publicado (fase 4).
- Observações: runtime 4,7 KB gzip. Ver D-010.

### 2026-10-14 03:58 — Tarefa 2.4 concluída
- O que foi feito: spa.ts (watchLocation com patch de pushState/replaceState + popstate), runtime reavalia na navegação, revert de experimentos que deixam de casar, onNavigate e stop().
- Arquivos principais: packages/snippet/src/{spa,runtime}.ts, e2e/tests/spa.spec.ts
- Como testar manualmente: pnpm e2e (spa.spec.ts)
- Observações: ver D-011.

### 2026-10-14 04:02 — Tarefa 2.5 concluída
- O que foi feito: tracker.ts (lote, sendBeacon text/plain, flush em conversão/pagehide, CustomEvent abt:event, adaptadores), goals.ts (click, pageview, formSubmit, custom), qa.ts (ab_force persistido na sessão, selo em Shadow DOM), main.ts (window.abq/window.abt), campo qa nos eventos, docs/EVENTOS.md.
- Arquivos principais: packages/snippet/src/{tracker,goals,qa,main}.ts, docs/EVENTOS.md, e2e/tests/tracking.spec.ts
- Como testar manualmente: pnpm e2e (tracking.spec.ts); no demo com snippet publicado, abrir /?ab_force=<exp>:<var>
- Observações: ver D-012.
