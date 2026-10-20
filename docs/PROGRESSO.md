# Progresso
**Status:** 17.5 concluída
**Fase atual:** 17
**Tarefa atual:** 17.6
**Última atualização:** 2026-10-20 06:12
**Próximo passo:** 17.6 receita por canal (atribuição first/last touch por origem, UTM e campanha).

## Bloqueios / perguntas para os humanos
- CPU do Worker grátis (10 ms) não basta para o Painel em produção ("Failed to fetch", ver 2026-10-20 02:53). Escolher: Workers Paid (US$ 5/mês) ou agregados diários no D1.
- Snippet a 7 B do limite de 10 KB gzip (10.233 B depois da 17.3; a lógica do link de pré-visualização ficou no preview.js sob demanda e o snippet só detecta o parâmetro): a próxima mudança relevante no runtime vai precisar do alvo es2020 (libera ~440 B; perde Safari < 13.1 e Chrome < 80, D-069) ou de enxugar mais. Decidir.
- Perguntas anteriores respondidas em docs/DECISOES.md D-033.

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


### 2026-10-14 04:03 — Tarefa 2.6 concluída
- O que foi feito: build do snippet falha se passar de 10 KB gzip. Tamanho medido em 2026-10-14 04:02: dist/abt.js = 14.306 B minificado, **6.221 B gzip** (gzip -9: 6.257 B). Meta < 10 KB atendida com ~4 KB de folga.
- Arquivos principais: packages/snippet/build.mjs
- Como testar manualmente: pnpm --filter @abtest/snippet build
- Observações: a config embutida soma ao arquivo publicado e é medida à parte (D-008). Corrigida intermitência no spa.spec.ts (espera por frame após reload).

### Resumo da Fase 2 — Snippet de runtime
- Entregue: runtime `@abtest/snippet` (6,2 KB gzip): config embutida no JS da conta (D-008), visitante em cookie first-party + localStorage, segmentação (URL/dispositivo/query/novo-recorrente), bucketing murmurhash3 com tráfego, pesos e persistência, bots ignorados, anti-flicker por elemento (+ modo página, timeout 1500 ms), SPA (pushState/replaceState/popstate com revert), customCSS/JS, redirect, eventos (exposure/conversion/selector_failed/selector_healed) com sendBeacon em lote e adaptadores, metas (clique, URL, form, custom), modo QA com selo. Contrato em docs/EVENTOS.md.
- Testes: 51 unitários (snippet) + 8 E2E Playwright (anti-flicker por frames e pixels, SPA, tracking, QA, bots).
- Limitações: segmentação por dispositivo é por UA/largura no load; customJS roda via `<script>` inline (sites com CSP sem 'unsafe-inline' bloqueiam); sem deduplicação de conversões no cliente.
- Como testar: `pnpm --filter @abtest/snippet test`, `pnpm e2e`.

### 2026-10-14 04:06 — Tarefa 3.1 concluída
- O que foi feito: schemas do protocolo (ElementInfo, VariationPayload, ApplyResult, OperationDraft, métodos/eventos dos dois lados, envelope) e createPeer tipado com validação, timeout, origem exata e dispose.
- Arquivos principais: packages/shared/src/{rpc,rpc-peer}.ts
- Como testar manualmente: pnpm --filter @abtest/shared test
- Observações: ver D-013.

### 2026-10-14 04:12 — Tarefa 3.2 concluída
- O que foi feito: API com POST/GET /edit-sessions (token 15 min, CORS restrito, Origin conferido) e CDN local servida com ETag/cache curto; compileAccountScript/writeAccountFiles; snippet: editToken + bootEditor (token na API, hello com targetOrigin exato, ack do parent com token), modo edição não aplica experimentos; packages/agent mínimo (peer + ready).
- Arquivos principais: apps/api/src/{app,sessions,cdn,server}.ts, packages/snippet/src/editor.ts, packages/agent/src/{agent,main}.ts, e2e/tests/handshake.spec.ts
- Como testar manualmente: pnpm e2e (handshake.spec.ts) — a UI do editor chega na 3.5.
- Observações: ver D-014.

### 2026-10-14 04:21 — Tarefa 3.3 concluída
- O que foi feito: inspect.ts (ElementInfo: seletor+alternativos+impressão digital, fragilidade, estilos computados, atributos, breadcrumb), overlay.ts (Shadow DOM: contorno/label de hover e seleção, breadcrumb clicável), agent.ts (modos edit/browse, bloqueio de eventos do site, select/highlight/applyVariation com revert, navigated em SPA). Helper e2e/host.ts imita o app.
- Arquivos principais: packages/agent/src/{agent,overlay,inspect}.ts, e2e/host.ts, e2e/tests/agent-select.spec.ts
- Como testar manualmente: pnpm e2e (agent-select.spec.ts)
- Observações: ver D-015.

### 2026-10-14 04:24 — Tarefa 3.4 concluída
- O que foi feito: editing.ts (edição inline com setText/setHTML, arrastar com indicador antes/depois/dentro, menu de contexto: editar, trocar imagem, esconder, remover, inserir antes/depois, copiar seletor, selecionar pai), overlay com alça, menu, indicador de drop e toast.
- Arquivos principais: packages/agent/src/{editing,overlay,agent}.ts, e2e/tests/agent-edit.spec.ts
- Como testar manualmente: pnpm e2e (agent-edit.spec.ts)
- Observações: ver D-016.

### 2026-10-14 04:28 — Tarefa 3.5 concluída
- O que foi feito: apps/editor (React 18 + Vite 6 + Tailwind 4): store com histórico, connectAgent (hello-ack + peer), TopBar (abas de variação, Editar/Navegar/Preview, dispositivo, desfazer/refazer, URL, status, salvar), PromptDialog (<dialog>), sincronização modo/variação a cada ready; atalhos de teclado.
- Arquivos principais: apps/editor/src/{App.tsx,store.ts,connection.ts,api.ts,components/TopBar.tsx,components/PromptDialog.tsx}, e2e/tests/editor-ui.spec.ts
- Como testar manualmente: pnpm dev; abrir http://localhost:5173 (demo em :5180, API em :4000); duplo clique no título, Navegar/Preview, abas.
- Observações: ver D-017.

### 2026-10-14 04:31 — Tarefa 3.6 concluída
- O que foi feito: PropertiesPanel (seletor + fragilidade + breadcrumb; texto, tipografia, cores, espaçamento, borda, atributos) e upsertOperation/findEquivalent/coalesceKey no store.
- Arquivos principais: apps/editor/src/components/PropertiesPanel.tsx, apps/editor/src/store.ts, e2e/tests/editor-properties.spec.ts
- Como testar manualmente: pnpm dev → http://localhost:5173, clicar no botão 'Comprar agora' e mudar fundo/tamanho/href no painel.
- Observações: ver D-018.

### 2026-10-14 04:34 — Tarefa 3.7 concluída
- O que foi feito: ChangesPanel (descrição, destacar, selecionar, ↑/↓, excluir, falha/curado), CodePanel com Monaco local e lazy (customCSS ao vivo, customJS com opt-in), abas da barra lateral, coalescência do código no histórico.
- Arquivos principais: apps/editor/src/components/{ChangesPanel,CodePanel}.tsx, apps/editor/src/describe.ts, apps/editor/src/App.tsx, e2e/tests/editor-changes.spec.ts
- Como testar manualmente: pnpm dev → editor → aba Alterações / CSS-JS.
- Observações: ver D-019.

### 2026-10-14 04:36 — Tarefa 3.8 concluída
- O que foi feito: e2e/tests/editor-flow.spec.ts — no editor real: texto (inline), cor (painel), esconder (menu), mover (arrastar), CSS custom (Monaco); conferido ao vivo, controle intacto, após salvar+recarregar o editor e após navegar no iframe.
- Arquivos principais: e2e/tests/editor-flow.spec.ts
- Como testar manualmente: pnpm e2e tests/editor-flow.spec.ts (ou o fluxo à mão em http://localhost:5173)
- Observações: persistência ainda em localStorage; passa para a API na fase 4.

### Resumo da Fase 3 — Editor (núcleo)
- Entregue: protocolo RPC tipado/validado (shared/rpc*), handshake seguro de 3 fatores (token na API + origin exato + parâmetro), agent em Shadow DOM (hover, seleção, breadcrumb, edição inline, arrastar, menu de contexto, applyVariation com revert), app do editor (React/Vite/Tailwind) com abas de variação, Editar/Navegar/Preview, dispositivos, desfazer/refazer, painel de propriedades, lista de alterações com alerta de falha/cura, CSS/JS com Monaco local.
- Testes: unitários em shared/agent/editor/api/snippet + E2E (handshake, agent, editor UI, propriedades, alterações, fluxo completo).
- Limitações: rascunho salvo em localStorage (API na fase 4); sessões de edição em memória; dispositivo só muda largura (não o UA); sem autenticação ainda.
- Como testar: `pnpm dev` e abrir http://localhost:5173; `pnpm e2e`.

### 2026-10-14 04:39 — Tarefa 4.1 concluída
- O que foi feito: schema Drizzle (8 tabelas, account_id em todas), migração gerada e aplicada no createDb, repositório com isolamento por conta, versões a cada salvamento, hash de senha scrypt.
- Arquivos principais: apps/api/src/{schema,repo,db}.ts, apps/api/drizzle/
- Como testar manualmente: pnpm --filter @abtest/api test
- Observações: ver D-020.

### 2026-10-14 04:44 — Tarefa 4.2 concluída
- O que foi feito: rotas OpenAPI (auth/login, me, projects, experiments CRUD + versões, edit-sessions autenticado, publish), JWT + papéis, seed de dev, editor com login/lista/abrir por ?exp e salvar na API; E2E atualizados (login e sessão autenticada).
- Arquivos principais: apps/api/src/{app,auth,seed}.ts, apps/editor/src/{App,EditorView,api}.ts(x), e2e/editor.ts, e2e/host.ts
- Como testar manualmente: pnpm dev → http://localhost:5173 (demo@abtest.dev / demo1234); http://localhost:4000/docs
- Observações: ver D-021.

### 2026-10-14 04:46 — Tarefa 4.3 concluída
- O que foi feito: publish.ts (compila running, versiona, regra de customJS, grava CDN), tabela events + POST /collect com validação e deduplicação, rota /publish ligada no server.
- Arquivos principais: apps/api/src/{publish,app,repo,schema}.ts, apps/api/drizzle/0001_*.sql
- Como testar manualmente: pnpm dev; no editor salvar um experimento running e chamar POST /publish (botão na 4.4); conferir cdn/demo.json.
- Observações: ver D-022.

### 2026-10-14 04:50 — Tarefa 4.4 concluída
- O que foi feito: SettingsPanel (status, tráfego, pesos, URLs, metas), botão Publicar (salva + /publish + aviso), patchExperiment/setWeight no store; E2E publish-flow: criar → editar → configurar → publicar → visitante real vê a variação e converte (/collect real) → pausar e republicar devolve o controle.
- Arquivos principais: apps/editor/src/components/SettingsPanel.tsx, apps/editor/src/EditorView.tsx, e2e/tests/publish-flow.spec.ts, e2e/reset-cdn.mjs
- Como testar manualmente: pnpm dev → editor → Config → Em execução + pesos → Publicar → abrir http://localhost:5180 em janela anônima.
- Observações: ver D-023.

### Resumo da Fase 4 — API, persistência e publicação
- Entregue: schema Postgres/Drizzle multi-tenant (account_id em tudo) com migrações automáticas (PGlite em dev/testes), API Hono + OpenAPI 3.1 (/openapi.json, /docs), JWT + papéis + permissão de customJS, versões a cada salvamento, publicação compilando JSON + JS por conta na CDN local, coleta de eventos (/collect) com deduplicação, editor com login, lista de experimentos, configurações (status/tráfego/pesos/URLs/metas) e Publicar.
- Testes: API (rotas, permissões, isolamento, publicação, coleta) + E2E do fluxo completo com visitante real.
- Limitações: sem refresh token/SSO; sessões de edição em memória; sem rate limit no /collect; "Publicar" publica a conta inteira (por design, um arquivo por conta); docker-compose não testado nesta máquina (PGlite usado).
- Como testar: `pnpm dev` → http://localhost:5173 (demo@abtest.dev / demo1234); `pnpm e2e`.

### 2026-10-14 04:53 — Tarefa 5.1 concluída
- O que foi feito: apps/extension (MV3): session.ts (regras DNR por aba/sub_frame/origin, validação do pedido, expiração, storage), sw.ts, bridge.ts (ponte app↔SW), content.ts (injeta o script da conta se o site não tem snippet), build com manifest; snippet marca data-abt-editor; editor tenta a extensão após 5 s sem conexão e avisa se não houver.
- Arquivos principais: apps/extension/src/*, apps/extension/build.mjs, apps/editor/src/{extension.ts,EditorView.tsx}
- Como testar manualmente: pnpm --filter @abtest/extension build; chrome://extensions → modo desenvolvedor → carregar apps/extension/dist; abrir no editor um site que bloqueia iframe (5.2).
- Observações: ver D-024 (SameSite não reescrito).

### 2026-10-14 04:55 — Tarefa 5.2 concluída
- O que foi feito: demo /bloqueado/com-snippet.html e /bloqueado/sem-snippet.html com X-Frame-Options DENY + CSP frame-ancestors 'none' (middleware do Vite); E2E com Chromium + extensão carregada: fallback automático e edição no site bloqueado, injeção em site sem snippet, outra aba continua bloqueada, aviso quando não há extensão.
- Arquivos principais: apps/demo/bloqueado/*.html, apps/demo/vite.config.ts, e2e/tests/extension.spec.ts
- Como testar manualmente: carregar apps/extension/dist no Chrome; no editor, URL http://localhost:5180/bloqueado/sem-snippet.html
- Observações: SameSite não reescrito (D-024).

### Resumo da Fase 5 — Extensão Chrome
- Entregue: extensão MV3 com ponte app↔service worker, regras declarativeNetRequest de sessão restritas à aba do editor/sub_frame/origin do site (remove XFO e CSP), expiração e limpeza, injeção do script da conta em sites sem snippet; editor com fallback automático e aviso.
- Testes: unitários das regras/sessões + E2E com Chromium real carregando a extensão.
- Limitações: SameSite de cookies não reescrito (D-024); CSP removido por inteiro durante a sessão (só no iframe da aba do editor); ponte configurada por build (`EDITOR_ORIGINS`).
- Como testar: `pnpm --filter @abtest/extension build`, carregar `apps/extension/dist`; `pnpm e2e tests/extension.spec.ts`.

### 2026-10-14 04:59 — Tarefa 6.1 concluída
- O que foi feito: GET /experiments/{id}/health (agregação SQL por operação e exposições), HealthPanel no editor (estado por alteração, taxa, seletor curado, adotar seletor), testes API + E2E. Corrigida colisão da chave de experimento novo (sufixo aleatório).
- Arquivos principais: apps/api/src/{repo,app}.ts, apps/editor/src/components/HealthPanel.tsx, e2e/tests/health.spec.ts
- Como testar manualmente: publicar um experimento, mudar o HTML do demo para quebrar um seletor, visitar o site e abrir a aba Saúde.
- Observações: ver D-025.

### 2026-10-14 08:16 — Tarefa 6.2 concluída
- O que foi feito: selectorFragility no packages/selector; editor mostra dica no painel, aviso ao criar alteração frágil e ⚠ na lista.
- Arquivos principais: packages/selector/src/fragility.ts, apps/editor/src/{EditorView.tsx,components/ChangesPanel.tsx,components/PropertiesPanel.tsx}, e2e/tests/fragile.spec.ts
- Como testar manualmente: no editor, esconder um item da lista 'Por que escolher' (sem classe/id).
- Observações: ver D-026.

### 2026-10-14 08:19 — Tarefa 6.3 concluída
- O que foi feito: conflicts.ts (alvos normalizados + sobreposição de páginas/dispositivos), GET /experiments/{id}/conflicts, editor mostra conflitos na lista e avisa ao publicar.
- Arquivos principais: apps/api/src/{conflicts,app,repo}.ts, apps/editor/src/{EditorView.tsx,components/ChangesPanel.tsx}, e2e/tests/conflicts.spec.ts
- Como testar manualmente: criar dois experimentos alterando o título da home; aba Alterações do segundo mostra ⚔.
- Observações: ver D-027.

### 2026-10-14 08:21 — Tarefa 6.4 concluída
- O que foi feito: GET /experiments/{id}/versions/{v} e POST .../restore (nova versão, histórico preservado); VersionsPanel no editor (lista, restaurar com confirmação); abas da barra lateral quebram linha.
- Arquivos principais: apps/api/src/app.ts, apps/editor/src/components/VersionsPanel.tsx, e2e/tests/versions.spec.ts
- Como testar manualmente: salvar duas vezes um experimento, aba Versões → Restaurar v1.
- Observações: ver D-028.

### Resumo da Fase 6 — Robustez
- Entregue: painel de saúde (falhas/curas por alteração a partir dos eventos, adotar seletor curado), aviso de seletor frágil (painel, criação e lista), detecção de conflito entre experimentos no mesmo elemento (lista + aviso ao publicar), histórico de versões com restauração append-only.
- Testes: unitários (selectorFragility, conflicts, health, versões) + E2E (health, fragile, conflicts, versions).
- Limitações: conflito usa heurística de sobreposição de páginas (página de referência × segmentação); saúde depende de eventos coletados pela nossa API (sem retenção/expurgo ainda).
- Como testar: `pnpm test`, `pnpm e2e`; no editor, abas Saúde, Alterações e Versões.

### 2026-10-14 08:27 — Tarefa 7.1 concluída
- O que foi feito: heatmap.ts no snippet (amostragem, cliques com posição relativa ao elemento, profundidade de scroll por página/SPA, variações ativas e dispositivo), tipos click/scroll no schema, publicação inclui heatmap.sampleRate, coleta grava eventos sem experimento.
- Arquivos principais: packages/snippet/src/heatmap.ts, packages/shared/src/{events,config}.ts, apps/api/src/{publish,repo,server}.ts, e2e/tests/tracking.spec.ts
- Como testar manualmente: publicar; navegar no demo; ver eventos click/scroll chegando em /collect (DevTools → Network).
- Observações: ver D-029.

### 2026-10-14 08:29 — Tarefa 7.2 concluída
- O que foi feito: GET /heatmap (cliques por seletor com pontos, alcance de scroll; filtros variação/dispositivo; normalização da página), normalizePage, documentação de click/scroll e da agregação em docs/EVENTOS.md.
- Arquivos principais: apps/api/src/{repo,app}.ts, docs/EVENTOS.md
- Como testar manualmente: navegar no demo publicado e GET http://localhost:4000/heatmap?url=http://localhost:5180/ com token.
- Observações: ver D-030.

### 2026-10-14 08:33 — Tarefa 7.3 concluída
- O que foi feito: createHeatmapLayer no agent (canvas colorizado, badges por elemento, faixas de scroll, redesenho em scroll/resize), RPC showHeatmap/hideHeatmap, modo 'Mapa de calor' no editor com filtros de variação e dispositivo, lista dos elementos mais clicados.
- Arquivos principais: packages/agent/src/heatmap.ts, packages/shared/src/rpc.ts, apps/editor/src/{EditorView.tsx,components/HeatmapPanel.tsx,components/TopBar.tsx}, e2e/tests/heatmap.spec.ts
- Como testar manualmente: publicar um experimento com HEATMAP_SAMPLE_RATE=1, clicar no demo, abrir o editor → Mapa de calor.
- Observações: ver D-031.

### Resumo da Fase 7 — Mapa de calor e mapa de cliques
- Entregue: captura no snippet (cliques com posição relativa ao elemento, profundidade de scroll por página/SPA, amostragem determinística, variações ativas e dispositivo), agregação `GET /heatmap` com filtros, overlay no agent (canvas colorizado, contagem por elemento, faixas de scroll) e modo "Mapa de calor" no editor.
- Limitações: agregação feita na leitura (sem pré-agregação/retenção); amostragem global por env (`HEATMAP_SAMPLE_RATE`); seletor do clique é caminho nth-of-type (pode não achar o elemento se o layout mudar muito — o painel informa quantos faltam).
- Como testar: `pnpm e2e tests/heatmap.spec.ts tests/tracking.spec.ts`.

### Resumo final do plano
- Todas as tarefas 0.1–7.3 concluídas com testes passando: 189 unitários (Vitest, 8 workspaces) + 37 E2E (Playwright, inclusive Chrome com a extensão carregada).
- Snippet: 7,2 KB gzip (meta < 10 KB).
- Pendências para os humanos: ver "Bloqueios / perguntas" (SameSite na extensão; config embutida no JS).
- Como subir tudo: `pnpm install && pnpm dev` → editor http://localhost:5173 (demo@abtest.dev / demo1234), API http://localhost:4000/docs, demo http://localhost:5180.

### 2026-10-14 14:15 — Deploy na Cloudflare e perguntas respondidas (fora do plano original)
- O que foi feito: API em Worker com D1 + KV (repositório D1 com o mesmo contrato do Postgres; suíte da API roda contra os dois), editor e demo como Workers estáticos, script `pnpm deploy:cf`, smoke test de produção. Perguntas abertas decididas (D-033): config embutida mantida; extensão passa a reescrever SameSite dos cookies do site durante a sessão, com restauração (D-034).
- URLs: editor https://abtest-editor.hub-villa-deli.workers.dev · demo https://abtest-demo.hub-villa-deli.workers.dev · API https://abtest-api.hub-villa-deli.workers.dev/docs · extensão /abtest-extension.zip no editor.
- Como testar: docs/DEPLOY.md (smoke: `PROD_PASSWORD=... pnpm --filter @abtest/e2e exec playwright test -c playwright.prod.config.ts`).
- Observações: usuários de produção usam a senha do segredo SEED_PASSWORD (definida só na criação; trocar a senha exige atualizar o usuário). Dev local: apagado .data/pglite (hashes antigos em scrypt).

### 2026-10-14 15:09 — Performance, redesign e loja de teste complexa (pedido pós-plano)
- O que foi feito: API em produção ~3–4× mais rápida (leituras em lote no D1, KV em paralelo, Smart Placement; editor sem chamadas encadeadas); redesign do login, lista em tabela (filtros, busca, ações rápidas, criar via modal) e editor (barra em duas linhas, estados de salvar/publicar, toasts, aviso de sair sem salvar, overlay de conexão); segmentação acompanha a página editada; site complexo /loja/ no demo; correções achadas pelos testes (seletor com id numérico em data-*, corrida no modal de criação, corrida da sessão da extensão ao trocar de domínio). Ver D-035.
- Arquivos principais: apps/editor/src/{App.tsx,EditorView.tsx,ui.tsx,components/TopBar.tsx}, apps/api/src/{repo-d1.ts,app.ts,publish.ts,cdn.ts,worker.ts}, apps/demo/loja/*, e2e/tests/loja.spec.ts
- Como testar manualmente: https://abtest-editor.hub-villa-deli.workers.dev → Novo experimento → atalho "Loja completa".
- Observações: tempos medidos em produção — salvar ~0,5–0,7 s, publicar ~0,85 s (antes 1 s e 3,6 s).

### 2026-10-14 22:48 — Tarefas 8.1–8.4 concluídas (feedback dos primeiros usuários)
- O que foi feito: engine não reaplica operação em outro elemento enquanto o original segue na página (HTML inserido duplicava; arrastar/remover por seletor de posição andava em cadeia); edição de texto ignora nós inseridos; menu "Editar HTML"; diálogo de HTML maior; CSS/JS com botão Expandir (janela grande); Configurações saíram da barra lateral para uma janela própria (botão na barra superior) com "Escolher no site" para a meta, aviso quando falta o seletor e regra de URL nova vazia com foco.
- Arquivos principais: packages/snippet/src/engine/apply.ts, packages/agent/src/editing.ts, apps/editor/src/{EditorView.tsx,components/SettingsPanel.tsx,components/CodePanel.tsx,components/TopBar.tsx,components/PromptDialog.tsx}
- Como testar manualmente: inserir HTML antes de um item de lista e mexer na página (não duplica); arrastar um card para depois do terceiro (fica); Configurações → Metas → Escolher no site → clicar no botão.
- Observações: ver D-037. "+ regra de URL" funcionava no Chromium (testado); a regra nova agora vem vazia e focada para ficar evidente.

### 2026-10-14 22:52 — Tarefa 8.5 concluída
- O que foi feito: coluna `accounts.heatmap_sample_rate` (Postgres + D1), `GET/PUT /account/settings` (PUT só owner), publicação usa a taxa da conta e cai no `HEATMAP_SAMPLE_RATE` quando vazia; menu do usuário → "Configurações da conta" (owner).
- Arquivos principais: apps/api/src/{schema,repo,repo-d1,app,publish}.ts, apps/api/drizzle/0002_*.sql, apps/api/migrations-d1/0002_account_settings.sql, apps/editor/src/{App.tsx,api.ts}
- Como testar manualmente: logar como owner → menu do usuário → Configurações da conta → 10 → publicar → `/cdn/demo.json` traz `heatmap.sampleRate: 0.1`.
- Observações: ver D-038. Deploy precisa de `wrangler d1 migrations apply` (já no `pnpm deploy:cf`).

### 2026-10-14 22:55 — Tarefa 8.6 concluída
- O que foi feito: expurgo dos eventos crus mais antigos que `EVENTS_RETENTION_DAYS` (padrão 90; 0 desliga) — no Node ao subir e a cada 24 h, no Worker por cron diário (04:00 UTC); detecção de rota de SPA também por `hashchange` e Navigation API (`currententrychange`).
- Arquivos principais: apps/api/src/{repo,repo-d1,server,worker}.ts, apps/api/wrangler.jsonc, packages/snippet/src/spa.ts
- Como testar manualmente: `EVENTS_RETENTION_DAYS=0` desliga; eventos antigos somem no próximo ciclo.
- Observações: ver D-039. Pré-agregação do mapa de calor continua adiada (agregação na leitura segura enquanto a retenção limita o volume).

### Resumo da Fase 8
- Entregue: correção da duplicação de HTML inserido e do arrastar que não fixava (engine), Editar HTML, CSS/JS em janela grande, configurações separadas da edição com meta escolhida no site, amostragem do mapa de calor por conta, retenção dos eventos e SPA mais robusta.
- Testes: unitários (engine persist, agent, API settings/expurgo, SPA) + 41 E2E.

### 2026-10-19 13:49 — Tarefa 9.1 concluída
- O que foi feito: Nova identidade visual (paleta quente, tinta + verde + lima, Fraunces/Inter Tight/JetBrains Mono, favicon/logo), moldura com menu lateral por módulo, roteamento ?view=, páginas Login/Experimentos/Instalação separadas, barra do editor em tinta.
- Arquivos principais: apps/editor/src/{index.css,ui.tsx,shell.tsx,nav.ts,App.tsx,pages/*,components/TopBar.tsx}
- Como testar manualmente: pnpm dev → http://localhost:5173 (login, lista, Instalação no menu, abrir um experimento).
- Observações: ver D-040.

### 2026-10-19 14:00 — Tarefa 9.2 concluída
- O que foi feito: Snippet: sessão (cookie 30 min), pageview em toda página/rota, comandos track/event/identify/set, perfil local; QA marca toda a sessão. API: colunas visitor_id/session_id, listEvents genérico (Postgres e D1), GET /analytics/overview e /events; rotas em src/routes. Editor: gráficos SVG próprios (charts.tsx, paleta validada) e tela Dados → Eventos (KPIs, série, rankings, fluxo ao vivo).
- Arquivos principais: packages/snippet/src/{data,env,runtime,main}.ts, apps/api/src/{routes/data.ts,analytics/overview.ts,http.ts,test-app.ts,repo.ts,repo-d1.ts}, apps/editor/src/{charts.tsx,pages/Events.tsx}
- Como testar manualmente: abrir o demo, rodar abq.push(['track','compra',10]) no console, ver em Dados → Eventos.
- Observações: ver D-041. Snippet 7,95 KB gzip.

### 2026-10-19 14:01 — Tarefa 9.3 concluída
- O que foi feito: packages/shared/src/stats.ts: posteriores Beta/Normal com Monte Carlo determinístico (prob. de vencer, de ser a melhor, perda esperada, intervalos, lift), z-test, Welch, SRM (qui-quadrado), tamanho de amostra, veredito.
- Arquivos principais: packages/shared/src/stats.ts, stats.test.ts
- Como testar manualmente: pnpm --filter @abtest/shared test
- Observações: ver D-042.

### 2026-10-19 14:09 — Tarefa 9.4 concluída
- O que foi feito: GET /experiments/{id}/report (visitantes, conversões únicas, receita, estatística bayesiana e frequentista por meta, série acumulada, SRM, duração estimada, filtro de dispositivo e período). Tela de relatório: manchete, tabela com faixa de intervalo 95%, receita, gráfico acumulado, comparar metas, CSV, imprimir; links na lista e no editor; meta primária nas configurações. pnpm seed:data.
- Arquivos principais: apps/api/src/{analytics/report.ts,routes/report.ts}, apps/editor/src/pages/Report.tsx, scripts/seed-data.ts, e2e/tests/report.spec.ts
- Como testar manualmente: pnpm seed:data → Experimentos → ícone de gráfico na linha 'Home: chamada Corra mais'.
- Observações: ver D-043.

### 2026-10-19 14:16 — Tarefa 10.1 concluída
- O que foi feito: Snippet detecta rage click, dead click e movimento do mouse (eventos frustration/move). /heatmap devolve movimento e frustração (filtros de dispositivo/variação). Agent desenha 5 modos (calor normalizado, cliques, scrollmap, movimento, frustração); painel com seletor de modo, resumo e lista de elementos. Gerador de dados com comportamento na home.
- Arquivos principais: packages/snippet/src/heatmap.ts, packages/agent/src/heatmap.ts, apps/api/src/analytics/behavior.ts, apps/editor/src/components/HeatmapPanel.tsx
- Como testar manualmente: pnpm seed:data → abrir 'Home: chamada Corra mais' → Mapa de calor → Frustração.
- Observações: ver D-044. Snippet 8,3 KB gzip.

### 2026-10-19 14:19 — Tarefa 10.2 concluída
- O que foi feito: GET /analytics/pages; tela Insights → Mapas de calor (lista de páginas) e visualizador em tela cheia sobre o site real (modos, filtros, largura por dispositivo); viewer pode abrir sessão de visualização.
- Arquivos principais: apps/api/src/analytics/pages.ts, apps/editor/src/pages/Heatmaps.tsx, e2e/tests/heatmaps-module.spec.ts
- Como testar manualmente: Insights → Mapas de calor → clicar numa página.
- Observações: ver D-045.

### 2026-10-19 14:26 — Tarefa 10.3 concluída
- O que foi feito: packages/insights (insights.js com rrweb, mascaramento, envio em blocos com divisão e keepalive); snippet carrega sob demanda para amostrados (heatmap.recordings/forms na config). API: POST /rec, tabelas recordings/recording_chunks (Postgres e D1), GET /recordings (filtros) e /recordings/{sessionId}; retenção.
- Arquivos principais: packages/insights/*, packages/snippet/src/insights.ts, apps/api/src/routes/recordings.ts, apps/api/src/{schema,repo,repo-d1}.ts, migrations
- Como testar manualmente: Navegar no demo e GET /recordings?days=1 com token.
- Observações: ver D-046.

### 2026-10-19 14:29 — Tarefa 10.4 concluída
- O que foi feito: Tela Insights → Gravações (filtros: período, dispositivo, página, duração, frustração, visitante) e player em tela cheia (rrweb Replayer, linha do tempo com marcadores clicáveis, velocidade, pular inatividade, escala do viewport, lista lateral de eventos).
- Arquivos principais: apps/editor/src/pages/Recordings.tsx, e2e/tests/recordings.spec.ts
- Como testar manualmente: Navegar no demo; Insights → Gravações → abrir a sessão.
- Observações: ver D-047.

### Resumo da Fase 9 — Plataforma CRO: nova cara + fundação de dados
- Entregue: identidade visual própria (paleta tinta/verde/lima, Fraunces + Inter Tight + JetBrains Mono, menu lateral por módulo), coleta de pageviews/eventos/identify com sessão e perfil local, motor estatístico (bayesiano + frequentista + SRM + amostra), relatório de experimento com receita, comparação de metas e CSV, gerador de dados `pnpm seed:data`.

### Resumo da Fase 10 — Behavior e Interaction Analytics
- Entregue: rage/dead clicks e movimento do mouse; overlay com 5 modos; módulo Mapas de calor independente de experimento; gravação de sessão com rrweb em bundle sob demanda (`insights.js`) e player com linha do tempo.
- Snippet: 8,5 KB gzip; insights.js: ~24 KB gzip (só amostrados).

### 2026-10-19 14:34 — Tarefa 11.1 concluída
- O que foi feito: insights.js mede formulários (tempo, hesitação, focos, re-preenchimento, preenchido, abandono) sem enviar valores; evento form; GET /analytics/forms; tela Insights → Formulários (funil chegaram/interagiram/enviaram + estatística por campo em 5 métricas); checkout no demo; gerador de dados com formulários.
- Arquivos principais: packages/insights/src/forms.ts, apps/api/src/analytics/forms.ts, apps/editor/src/pages/Forms.tsx, apps/demo/produto.html
- Como testar manualmente: Insights → Formulários (após pnpm seed:data).
- Observações: ver D-048.

### 2026-10-19 14:40 — Tarefa 11.2 concluída
- O que foi feito: Tabela/CRUD genérico de entidades (Postgres e D1, /entities/{kind} com schema por tipo). Funis: schema (passos URL/evento, janela), GET /analytics/funnel/{id} (ordem, janela, conversão, tempo mediano, abandono com próxima página, filtro de dispositivo); tela Insights → Funis com construtor de passos e relatório.
- Arquivos principais: packages/shared/src/entities.ts, apps/api/src/{routes/entities.ts,analytics/funnel.ts}, apps/editor/src/pages/Funnels.tsx
- Como testar manualmente: Insights → Funis → Novo funil (Home exata + /produto contém).
- Observações: ver D-049.

### 2026-10-19 14:42 — Tarefa 11.3 concluída
- O que foi feito: GET /analytics/journeys (entradas, saídas, bounce, caminhos, explorador de página); tela Insights → Jornadas com explorador clicável.
- Arquivos principais: apps/api/src/analytics/journeys.ts, apps/editor/src/pages/Journeys.tsx
- Como testar manualmente: Insights → Jornadas; clicar numa página para explorar.
- Observações: ver D-050.

### 2026-10-19 14:47 — Tarefa 11.4 concluída
- O que foi feito: GET /analytics/cohorts (semana/dia, retenção ou conversão acumulada); tela Insights → Coortes (matriz com escala sequencial); gerador de dados corrigido (ts inteiro, PRNG melhor, visitantes recorrentes).
- Arquivos principais: apps/api/src/analytics/cohorts.ts, apps/editor/src/pages/Cohorts.tsx, scripts/seed-data.ts
- Como testar manualmente: Insights → Coortes (após pnpm seed:data).
- Observações: ver D-051.

### Resumo da Fase 11 — Form e Journey Analytics
- Entregue: form analytics por campo (capturado no insights.js), entidades genéricas de configuração, funis com análise de abandono, jornadas com explorador de página e coortes de retenção/conversão.

### 2026-10-19 15:03 — Tarefa 12.1 concluída
- O que foi feito: Tipo de campanha no experimento (colunas JSON options/extra nos dois bancos), criação por tipo (A/B, URL dividida, MVT, personalização com holdout, rollout gradual, server-side), redirect editável, menu por tipo, página de campanha server-side com variáveis, gerador de combinações MVT (shared/mvt.ts), snippet ignora server-side, relatório de rollout.
- Arquivos principais: packages/shared/src/{experiment,mvt}.ts, apps/api/src/{schema,repo,repo-d1}.ts, apps/editor/src/{campaigns.ts,store.ts,pages/Experiments.tsx,pages/ServerExperiment.tsx,components/*}
- Como testar manualmente: Experimentos → Nova campanha → escolher o tipo.
- Observações: ver D-052. E2E completo em ambiente limpo: 46/46.

### 2026-10-19 15:07 — Tarefa 12.2 concluída
- O que foi feito: MVT: abas de seções × opções no editor (adicionar/renomear/remover), edição por opção com combinações regeneradas, relatório com efeito por seção.
- Arquivos principais: apps/editor/src/{store.ts,components/TopBar.tsx,pages/Report.tsx}, apps/api/src/analytics/report.ts, e2e/tests/mvt.spec.ts
- Como testar manualmente: Nova campanha → Multivariado → editar opção → + Seção.
- Observações: ver D-053.

### 2026-10-19 15:10 — Tarefa 12.3 concluída
- O que foi feito: banditWeights (Thompson + piso de 5%), rebalance/rebalanceAll com usuário de sistema sem permissão de JS, job de hora em hora (Node e cron do Worker), POST /experiments/{id}/rebalance, alternância nas Configurações e botão no relatório.
- Arquivos principais: packages/shared/src/stats.ts, apps/api/src/{bandit.ts,routes/report.ts,server.ts,worker.ts}, apps/api/wrangler.jsonc, apps/editor/src/{components/SettingsPanel.tsx,pages/Report.tsx}
- Como testar manualmente: Configurações → Alocação automática; Relatório → Rebalancear agora.
- Observações: ver D-054.

### Resumo da Fase 12 — Experimentação avançada
- Entregue: tipos de campanha (A/B, URL dividida, MVT, personalização com holdout, rollout gradual, server-side), teste multivariado com seções/combinações e efeito por seção, multi-armed bandit com rebalanceamento automático.

### 2026-10-19 15:17 — Tarefa 13.1 concluída
- O que foi feito: Schema de audiência (14 tipos de regra), avaliador no snippet com perfil local (caminhos, first-touch), gate no runtime, publicação das audiências usadas, tela Dados → Audiências com construtor de regras, seleção nas Configurações do experimento; mapa de calor movido para insights.js.
- Arquivos principais: packages/shared/src/entities.ts, packages/snippet/src/{audience,data,runtime,insights,main}.ts, packages/insights/src/heatmap.ts, apps/api/src/publish.ts, apps/editor/src/{pages/Audiences.tsx,components/SettingsPanel.tsx}
- Como testar manualmente: Dados → Audiências → Nova; abrir experimento → Configurações → marcar a audiência → Publicar.
- Observações: ver D-055. Snippet 8,5 KB.

### 2026-10-19 15:19 — Tarefa 13.2 concluída
- O que foi feito: renderTemplate/renderOperations no snippet com escape por contexto (HTML, URL, evento), aplicados na ativação da variação; dica no painel de texto.
- Arquivos principais: packages/snippet/src/dynamic.ts, apps/editor/src/components/PropertiesPanel.tsx
- Como testar manualmente: Texto da variação: 'Olá, {{attr.nome|visitante}}' → abq.push(['set',{nome:'Ana'}]) no site.
- Observações: ver D-056. Snippet 8,9 KB.

### 2026-10-19 18:25 — Tarefa 13.3 concluída
- O que foi feito: Schema popup + gatilhos + segmentação; packages/engage (engage.js: gatilhos, renderizador em Shadow DOM, frequência, eventos engage); snippet carrega sob demanda; publicação; GET /analytics/engage; tela Engajamento → Pop-ups com editor e pré-visualização real.
- Arquivos principais: packages/engage/*, packages/snippet/src/engage.ts, apps/api/src/{publish.ts,analytics/engage.ts}, apps/editor/src/{pages/Popups.tsx,components/EngageFields.tsx}
- Como testar manualmente: Engajamento → Novo pop-up → gatilho 'Ao carregar' → Salvar e publicar → abrir o demo.
- Observações: ver D-057.

### 2026-10-19 18:32 — Tarefa 13.4 concluída
- O que foi feito: Schema survey (7 tipos, lógica), widget passo a passo no engage.js, evento survey, publicação, GET /analytics/survey/{id} (NPS, CSAT, CES, distribuições, escolhas, palavras), telas Engajamento → Pesquisas (editor com pré-visualização interativa) e relatório.
- Arquivos principais: packages/engage/src/survey.ts, apps/api/src/analytics/surveys.ts, apps/editor/src/pages/Surveys.tsx
- Como testar manualmente: Engajamento → Pesquisas → Nova → 'Ao carregar' → publicar → responder no demo → abrir a pesquisa.
- Observações: ver D-058.

### 2026-10-19 18:43 — Tarefa 13.5 concluída
- O que foi feito: Comandos product/cart/purchase no snippet; modelo de recomendação (catálogo, co-visualização, comprados juntos, em alta, mais vendidos, por categoria) na CDN; estratégias puras compartilhadas; API pública /reco; rebuild por rota, publicação e job horário; vitrine no engage.js; loja demo integrada; tela Engajamento → Recomendações com pré-visualização.
- Arquivos principais: packages/shared/src/reco.ts, apps/api/src/reco.ts, packages/engage/src/reco.ts, apps/editor/src/pages/Recos.tsx, apps/demo/loja/loja.js
- Como testar manualmente: Engajamento → Recomendações → Nova vitrine (#produtos) → publicar → abrir /loja/.
- Observações: ver D-059.

### Resumo da Fase 13 — Segmentação, personalização e engajamento
- Entregue: audiências com 14 tipos de regra avaliadas no navegador, conteúdo dinâmico seguro, pop-ups/barras com gatilhos, pesquisas NPS/CSAT/CES com lógica e relatório, recomendações (cross-sell, upsell, próxima melhor oferta) com vitrine e API pública.
- Bundles: snippet 9,15 KB gzip; insights.js ~25 KB (amostrados); engage.js 6,8 KB (só com campanha publicada).

### 2026-10-19 18:47 — Tarefa 14.1 concluída
- O que foi feito: Grafo de identidade (identify), perfis unificados (GET /profiles com busca e resumo cross-device; GET /profiles/{id} com linha do tempo e gravações), telas Dados → Perfis e perfil; gerador com clientes em dois dispositivos.
- Arquivos principais: apps/api/src/{analytics/profiles.ts,routes/cdp.ts}, apps/editor/src/pages/Profiles.tsx
- Como testar manualmente: Dados → Perfis → Identificados → abrir um cliente.
- Observações: ver D-060.

### 2026-10-19 18:51 — Tarefa 14.2 concluída
- O que foi feito: Entidade segment (regras sobre o perfil), GET /profiles/segments/{id} (membros, CSV), GET /decide (segmentos, campanhas server-side, próxima melhor oferta), tela Dados → Segmentos com construtor, membros, exportação e documentação da API.
- Arquivos principais: packages/shared/src/entities.ts, apps/api/src/{analytics/profiles.ts,routes/cdp.ts}, apps/editor/src/pages/Segments.tsx
- Como testar manualmente: Dados → Segmentos → Novo (ex.: Atributo plano = pro) → CSV.
- Observações: ver D-061.

### 2026-10-19 18:59 — Tarefa 14.3 concluída
- O que foi feito: Entidade flag, publicação de <conta>.sdk.json, packages/sdk (isEnabled, getVariables, getVariation com exposição, track com conversões, recarga periódica, envio em lote), tela Testes → Feature flags (liga/desliga na lista, rollout, regras, variáveis, exemplo de SDK).
- Arquivos principais: packages/sdk/*, packages/shared/src/{entities,sdk-config}.ts, apps/api/src/publish.ts, apps/editor/src/pages/Flags.tsx
- Como testar manualmente: Testes → Feature flags → Nova → /cdn/demo.sdk.json.
- Observações: ver D-062.

### 2026-10-19 19:10 — Tarefa 14.4 concluída
- O que foi feito: Chaves de API (hash, papel, revogação), webhooks assinados (eventos e publicação, teste), GA4/GTM no snippet; tela Configurar → Integrações
- Arquivos principais: apps/api/src/{auth,webhooks}.ts, apps/api/src/routes/integrations.ts, packages/snippet/src/integrations.ts, apps/editor/src/pages/Integrations.tsx
- Como testar manualmente: Integrações: criar chave e chamar curl -H 'Authorization: Bearer <chave>' localhost:4000/experiments; webhook para webhook.site e Enviar teste; ligar GA4 e ver gtag no console do site
- Observações: Snippet 9,3 KB gzip. Retry de webhook fica para quando houver fila.

### 2026-10-19 19:17 — Tarefa 15.1 concluída
- O que foi feito: Painel geral com tráfego e variação vs período anterior, testes no ar com líder/SRM, frustração, scroll, formulários, engajamento, perfis e dispositivos
- Arquivos principais: apps/api/src/analytics/dashboard.ts, apps/api/src/routes/data.ts, apps/editor/src/pages/Dashboard.tsx
- Como testar manualmente: pnpm seed:data e abrir ?view=home; trocar período 7/30/90 dias; clicar num teste abre o relatório
- Observações: Uma leitura de eventos (até 50 mil) cobre os dois períodos.

### 2026-10-19 19:21 — Tarefa 15.2 concluída
- O que foi feito: Insights automáticos no painel: vencedor, SRM, frustração, campo de formulário com abandono, passo de funil, página pouco lida e variação que diverge por dispositivo
- Arquivos principais: apps/api/src/analytics/insights.ts, apps/editor/src/pages/Dashboard.tsx
- Como testar manualmente: Abrir ?view=home com dados do seed; clicar num achado abre a tela que o prova
- Observações: Limiares em LIMITS.

### 2026-10-19 19:31 — Tarefa 15.3 concluída
- O que foi feito: Propensão a converter: features compartilhadas snippet/API, regressão logística com teste separado (AUC, decis, pesos), modelo publicado na config, score no navegador para a regra de audiência; tela Insights → Preditivo
- Arquivos principais: packages/shared/src/predict.ts, apps/api/src/predict.ts, apps/api/src/routes/predictive.ts, packages/snippet/src/runtime.ts, apps/editor/src/pages/Predictive.tsx
- Como testar manualmente: pnpm seed:data; Insights → Preditivo, meta compra, Treinar; criar audiência Score ≥ valor sugerido
- Observações: Retreino junto com o job de hora em hora.

### 2026-10-19 19:39 — Tarefa 15.4 concluída
- O que foi feito: Ideias de teste com Claude (saída estruturada, fallback de recusa, validação) ou por regras sem chave; piloto automático (bandit + corta perdedoras + tudo para a vencedora); telas Testes → Otimização por IA e alocação em 3 modos
- Arquivos principais: apps/api/src/ai.ts, apps/api/src/routes/ai.ts, apps/api/src/bandit.ts, apps/editor/src/pages/Optimize.tsx, apps/editor/src/components/SettingsPanel.tsx
- Como testar manualmente: Sem chave: Otimização por IA → Gerar ideias (por regras). Com ANTHROPIC_API_KEY na API: idem, por Claude. Num teste: Configurações → Alocação → Piloto automático; Relatório → Rebalancear
- Observações: Fase 15 concluída.

### Resumo das Fases 14 e 15 — CDP, flags, integrações, reporting e IA
- CDP: perfis com resolução de identidade e cross-device, segmentos sobre o perfil unificado com exportação CSV, `GET /decide` para personalização cross-channel.
- Feature flags e experimentos server-side com `@abtest/sdk` (decisão local, mesmo hash do snippet).
- Integrações: chaves de API (hash, papel, revogação), webhooks assinados (eventos e publicação), GA4 e GTM pelo snippet.
- Painel geral com KPIs de todos os módulos e insights automáticos (vencedor, SRM, frustração, campo de formulário, passo de funil, scroll baixo, segmento divergente).
- Analytics preditivo: regressão logística treinada na API, publicada na config e avaliada no navegador (regra de audiência `score`).
- Otimização por IA: ideias de teste com Claude (`ANTHROPIC_API_KEY`) ou por regras; piloto automático (bandit + corta perdedoras + tudo para a vencedora).
- Robustez achada no E2E final: publicações simultâneas da mesma conta agora saem em fila (antes a mais lenta podia gravar config velha); testes E2E de pop-up/pesquisa isolados por URL e teste de audiência com pesos 0/100.

### Resumo final das fases 9–15
- Testes: Vitest em todos os workspaces + E2E Playwright 53/53 (três execuções seguidas sem falha). Snippet 9,6 KB gzip (< 10 KB).
- Pendências conhecidas (ver DECISOES): retry/fila de webhooks; fila de publicação vale só por processo/isolate; ideias com Claude dependem da chave no ambiente.


### 2026-10-19 21:44 — Robustez, menu lateral e IA grátis
- O que foi feito: menu lateral em sanfona (um grupo aberto por vez, o da tela atual; cabe sem rolar); ideias de teste com modelo grátis compatível com OpenAI (Gemini/Groq/OpenRouter/Ollama) além do Claude; testes automáticos de robustez na API (fuzz de todas as rotas do OpenAPI e dos dados de cada entidade/experimento) e na interface (todas as telas: campos com lixo, clique duplo em botões e janelas, XSS).
- Bugs achados e corrigidos: byte nulo em id/query/corpo derrubava o Postgres (500) → 400 na entrada; `/collect` com corpo `null` → 500; nomes só com espaços ou de 200 mil caracteres aceitos → trim + limite; clique duplo em Ativar/Ligar/GA4/Salvar mandava o envio duas vezes (criava segmento e integração duplicados) → `Button` e `Switch` travam enquanto a ação anterior não termina; Copiar sem permissão de área de transferência estourava erro → aviso.
- Arquivos principais: apps/api/src/fuzz.test.ts, e2e/tests/robustness.spec.ts, apps/editor/src/ui.tsx (usePending, useCopy), apps/editor/src/shell.tsx, apps/api/src/ai.ts
- Como testar manualmente: `pnpm --filter @abtest/api exec vitest run src/fuzz.test.ts`; `pnpm e2e` (robustez roda por último, projeto "robustez"; só ela: `pnpm --filter @abtest/e2e e2e --project robustez --no-deps`). IA grátis: ver docs/DEPLOY.md.
- Observações: E2E não reaproveita mais a API do `pnpm dev` (sujaria o banco de dev); pare o dev antes do `pnpm e2e`.

### 2026-10-20 01:30 — Dados de demonstração em produção
- O que foi feito: `pnpm seed:data` reescrito: 60 dias de tráfego com crescimento e fim de semana mais fraco, origens com UTM, três experimentos (home vence, produto inconclusivo, loja ganha no celular e perde no desktop), funis, pop-up de cupom, barra de frete, NPS pós-compra com comentários, recomendações, audiências, segmentos, flags e perfis cross-device. Rodado em produção na conta demo (somado aos rascunhos existentes).
- Arquivos principais: scripts/seed-data.ts
- Como testar manualmente: abrir o Painel em produção; local: `pnpm seed:data`. Produção: `API_URL=... SITE_URL=... EDITOR_ORIGIN=... SEED_PASSWORD=... pnpm seed:data`.
- Observações: cada evento grava 7 linhas no D1 (tabela + índices); 1500 visitantes ≈ 12,9 mil eventos ≈ 90 mil linhas, perto do limite grátis de 100 mil por dia. Rodar de novo soma tráfego (não duplica campanhas).

### 2026-10-20 02:30 — Carregamento sem dado velho, ideias guardadas, gravações
- O que foi feito: `useLoad` + esqueletos (`Skeleton`, `LoadingBlock`) em todas as telas: trocar seleção/filtro nunca mostra o dado anterior e respostas atrasadas são descartadas. Contagens da lista de campanhas por tipo. Menu lateral volta a rolar (barra fina, grupos recolhíveis lembrados, item ativo à vista). Ideias da IA geradas em segundo plano na API e guardadas na conta até serem executadas ou descartadas (GET/POST/PUT/DELETE /ai/ideas). Checkout do demo não põe dados na URL. Duas gravações reais no demo de produção.
- Arquivos principais: apps/editor/src/ui.tsx, apps/editor/src/shell.tsx, apps/api/src/routes/ai.ts, apps/editor/src/pages/Optimize.tsx, e2e/tests/funnels.spec.ts, e2e/tests/optimize.spec.ts
- Como testar manualmente: Funis com dois funis, trocar rápido; Otimização por IA → Gerar ideias, sair e voltar.
- Observações: no Worker grátis a geração tem orçamento de 27 s (limite do waitUntil); estourou, cai nas regras.

### 2026-10-20 — Comparação com a VWO e próximas fases
- "Conversion Rate Optimization.pdf" (pedido original das fases 9–15) está coberto. Parciais: Mobile (só web no celular, sem app nativo → 19.3) e Revenue Attribution (receita por variação, sem atribuição por canal → 17.6).
- O que a VWO tem e o app não (fontes de 2026, de terceiros; conferir em vwo.com): Copilot (variação por texto, resumos de gravação/heatmap/pesquisa), testes em app nativo, gestão de hipóteses, auditoria/aprovação/SSO/2FA/multi-conta, grupos mutuamente exclusivos, teste multipágina, integrações prontas (Shopify, WordPress, Segment, Mixpanel, Amplitude, CRMs), consentimento LGPD. Viraram as fases 16–19 do PLANO.md.

### Contexto para retomar (estado em 2026-10-20)
- Produção (Cloudflare, plano grátis): editor https://abtest-editor.hub-villa-deli.workers.dev, API https://abtest-api.hub-villa-deli.workers.dev, demo https://abtest-demo.hub-villa-deli.workers.dev. Deploy: `pnpm deploy:cf` (precisa `wrangler login`). Conta demo com dados de demonstração (`pnpm seed:data`, ver entrada de 01:30) e config publicada v32 (3 testes, pop-ups, NPS e gravação no ar no site demo).
- IA: Gemini grátis (vars AI_BASE_URL/AI_MODEL/AI_REASONING no apps/api/wrangler.jsonc, chave no secret AI_API_KEY). A chave atual foi colada no chat: trocar por uma nova no AI Studio.
- Limites do plano grátis que já apareceram: D1 100 mil linhas escritas/dia (cada evento = 7 linhas); KV 1.000 escritas/dia (cada deploy/publicação escreve várias); 5 cron triggers por conta (a API usa 1); waitUntil do Worker ~30 s.
- Pendências: repositório sem remote git (push não feito); E2E não pode rodar com `pnpm dev` ligado (portas 4000/5173/5180 e o E2E não reaproveita a API).
- Testes: `pnpm test` (API com fuzz de todas as rotas, contra Postgres e D1), `pnpm e2e` (funcional + robustez de todas as telas; 82 testes).

### 2026-10-20 02:53 — "Failed to fetch" no Painel (produção)
- Causa: `GET /analytics/dashboard` gasta ~46 ms de CPU (lê e agrega os eventos do período atual + anterior); o plano grátis do Workers permite 10 ms. A Cloudflare encerra o Worker (`exceededCpu`, visto com `wrangler tail`) e responde 503 sem cabeçalho CORS, então o navegador só vê "Failed to fetch". Outras telas que leem muitos eventos podem cair no mesmo limite conforme o tráfego cresce.
- Feito: o editor troca o "Failed to fetch" cru por uma mensagem clara (apps/editor/src/api.ts). Repositório publicado em https://github.com/Gabriell-Braga/experimenta (remote `origin`).
- Correção de verdade (decisão humana, ver "Bloqueios / perguntas"): plano Workers Paid (US$ 5/mês, 30 s de CPU por requisição) ou agregados diários pré-calculados no D1 para os relatórios.

### 2026-10-20 03:03 — Tarefa 16.1 concluída (consentimento LGPD/GDPR)
- O que foi feito: modo "esperar consentimento" por conta (Configurar → Privacidade): até o aceite o snippet não grava cookies nem storage, não aplica testes, não carrega insights.js/engage.js e não envia eventos; comandos da fila esperam. `abq.push(['consent', true|false])` aceita/recusa a qualquer momento; recusar desliga o que estiver rodando (testes, coleta, gravação), apaga cookies e storage `_abt*` e vale nas próximas páginas (cookie `_abt_c`). Link `?abt_optout=1`. Leitura automática de OneTrust, Cookiebot e Google Consent Mode v2 com categoria configurável. Entidade `consent` na API vai para a config publicada só quando exigido.
- Arquivos principais: packages/snippet/src/consent.ts, packages/snippet/src/main.ts, packages/shared/src/entities.ts (ConsentSchema), packages/shared/src/config.ts, apps/api/src/publish.ts, apps/editor/src/pages/Privacy.tsx, e2e/tests/consent.spec.ts
- Como testar manualmente: Configurar → Privacidade → ligar "Esperar consentimento" → Salvar e publicar; abrir o site demo (nada muda, sem cookies `_abt`), no console `abq.push(['consent', true])` (teste aplicado), depois `abq.push(['consent', false])` (cookies somem, só `_abt_c=0`). `pnpm --filter @abtest/e2e e2e tests/consent.spec.ts`.
- Observações: snippet 10.182 B gzip (limite 10.240 B): sobra pouco; ver D-069 sobre o alvo es2020. Com espera de consentimento, a primeira página só recebe o teste depois do aceite (sem anti-flicker antes disso).

### 2026-10-20 03:18 — Tarefa 16.2 concluída (multi-conta, convites, conta nova)
- O que foi feito: `users` passa a ser a pessoa (login) e o papel fica por conta em `memberships` (migração leva o papel de cada usuário existente). O JWT carrega a conta ativa; o middleware carrega a pessoa como membro dessa conta, então todas as rotas seguem iguais e filtrando por account_id. Menu do usuário lista as contas (troca recarrega a página) e cria conta nova (quem cria vira owner, com o primeiro projeto). Configurar → Equipe: membros (papel, "publica JS", remover, sair da conta; a conta nunca fica sem owner) e convites por link de uso único (7 dias), que o owner copia e manda. O link abre a tela de aceite: quem já tem login confirma a senha; e-mail novo cria nome e senha. Login volta para a última conta usada (ou a padrão).
- Arquivos principais: apps/api/src/routes/team.ts, apps/api/src/repo.ts, apps/api/src/repo-d1.ts, apps/api/src/schema.ts, apps/api/drizzle/0007_optimal_mandroid.sql, apps/api/migrations-d1/0007_memberships.sql, apps/editor/src/pages/Team.tsx, apps/editor/src/pages/Invite.tsx, apps/editor/src/shell.tsx, e2e/tests/team.spec.ts
- Como testar manualmente: entrar como demo@abtest.dev → Configurar → Equipe → convidar um e-mail → abrir o link em janela anônima, criar o acesso → menu do usuário → Nova conta → trocar entre as contas pelo menu. `pnpm --filter @abtest/api exec vitest run src/routes/team.test.ts`; `pnpm --filter @abtest/e2e e2e tests/team.spec.ts`.
- Observações: sem serviço de e-mail, o convite não é enviado: o owner copia o link (D-070). Em produção, o próximo `pnpm deploy:cf` aplica a migração 0007 no D1. Sem cadastro público (só quem já tem login cria conta) e sem limite de contas por pessoa.

### 2026-10-20 03:29 — Tarefa 16.3 concluída (histórico de atividades)
- O que foi feito: tabela `activities` (pessoa, ação, tipo e nome do alvo copiados na linha) gravada por um middleware único (`audit.ts`) que observa as escritas bem sucedidas das rotas de configuração: testes (criar, editar, iniciar, pausar, arquivar, restaurar versão, duplicar, rebalancear, excluir), campanhas e demais entidades (status de pop-up/pesquisa também vira iniciar/pausar), publicação, projetos, configurações, chaves de API, convites e equipe (entrou pelo convite, mudou papel, removeu, saiu). Salvamentos seguidos do mesmo alvo pela mesma pessoa em 10 min viram uma linha. `GET /activities` com filtro por pessoa, tipo e alvo e paginação. Tela Configurar → Atividades (filtros na URL, "Carregar mais") e linha do tempo no relatório do experimento.
- Arquivos principais: apps/api/src/audit.ts, apps/api/src/routes/activities.ts, apps/api/src/repo.ts, apps/api/src/repo-d1.ts, apps/api/drizzle/0008_first_human_robot.sql, apps/api/migrations-d1/0008_activities.sql, apps/editor/src/pages/Activity.tsx, e2e/tests/activity.spec.ts
- Como testar manualmente: criar um teste, iniciar e pausar pela lista; abrir o relatório (card Atividades no fim) e Configurar → Atividades, filtrar por pessoa/tipo. `pnpm --filter @abtest/api exec vitest run src/audit.test.ts`; `pnpm --filter @abtest/e2e e2e tests/activity.spec.ts`.
- Observações: em produção, o próximo `pnpm deploy:cf` aplica a migração 0008 no D1. Ações automáticas (bandit de hora em hora, piloto automático) não entram, só o que uma pessoa ou chave de API fez. Sem expurgo de atividades antigas (D-071).

### 2026-10-20 04:28 — Tarefa 16.4 concluída (fluxo de aprovação de publicação)
- O que foi feito: opção por conta "exigir aprovação" (coluna `accounts.require_approval`, liga em Configurar → Aprovações, só owner). Ligada, quem não pode aprovar (editor sem "publica JS", chave de API) recebe 202 no `POST /publish` e vira um pedido (um pendente por pessoa; pedir de novo atualiza o recado); quem aprova (owner ou "publica JS") aprova = publica a configuração atual (os outros pendentes vão junto) ou recusa com comentário obrigatório. A checagem fica no publicador: sem aprovação, só republica o que já foi aprovado, então o rebalanceamento de hora em hora e o retreino preditivo continuam publicando pesos/modelo, mas nunca mudança pendente. Notificação: contador no item Aprovações do menu (pendentes para quem aprova; respostas não vistas para quem pediu), aviso em toda tela que publica e webhook `approval` (pending/approved/rejected). Pedido, aprovação e recusa entram no histórico de atividades.
- Arquivos principais: apps/api/src/routes/approvals.ts, apps/api/src/publish.ts, apps/api/src/app.ts, apps/api/src/audit.ts, apps/api/src/webhooks.ts, apps/api/drizzle/0009_past_scourge.sql, apps/api/migrations-d1/0009_require_approval.sql, apps/editor/src/pages/Approvals.tsx, apps/editor/src/shell.tsx, apps/editor/src/api.ts, e2e/tests/approvals.spec.ts
- Como testar manualmente: owner → Configurar → Aprovações → ligar; entrar como editor@abtest.dev, mudar algo em execução e Publicar (aviso "Enviado para aprovação"); owner vê o contador no menu, recusa com comentário ou aprova. `pnpm --filter @abtest/api exec vitest run src/routes/approvals.test.ts`; `pnpm --filter @abtest/e2e e2e tests/approvals.spec.ts`.
- Observações: em produção, o próximo `pnpm deploy:cf` aplica a migração 0009 no D1. Aprovar publica o estado do momento da aprovação (não um retrato do pedido); sem diff visual do que mudou (D-072). Exclusões silenciosas em listas (pop-up, pesquisa, flag) com aprovação ligada viram pedido sem aviso na hora (o contador mostra).

### 2026-10-20 04:50 — Tarefa 16.5 concluída (segurança de acesso: duas etapas, sessões, base de SSO)
- O que foi feito: login em duas etapas (TOTP, RFC 6238 com HMAC-SHA1 do Web Crypto) opcional por pessoa: configurar mostra a chave base32 e o link `otpauth://` (sem QR), ativar pede um código e devolve 10 códigos de recuperação (uma vez; só o hash fica). Com TOTP, o login devolve um desafio de 5 min e `POST /auth/login/totp` aceita o código do app (uma vez por passo, ±30 s) ou um de recuperação; 5 erros seguidos bloqueiam 15 min. Desativar pede senha + código; novos códigos pedem código. Convite para login com TOTP pede o código. Owner (com TOTP ligado) exige duas etapas na conta: quem não ativou só vê a tela de ativação (API responde 403 `totp_required` fora de `/me/*`, `/sessions*` e troca de conta); chave de API não é afetada. Sessões de login revogáveis: tabela `user_sessions`, o JWT carrega `sid` conferido a cada requisição; Configurar → Segurança lista as sessões (aparelho, IP, conta, atividade), encerra uma ou "sai de todos os outros"; "Sair" no menu encerra a sessão na API. Base de SSO: configuração OIDC/SAML por conta (entidade interna `sso`, segredo só escrita), ponto de extensão `SsoProvider` e fluxo start → IdP → callback → sessão (`#sso=` na URL do editor); nenhum protocolo implementado ainda (ver D-073). Ativar, desativar, novos códigos, encerrar sessões, exigência e SSO entram na auditoria.
- Arquivos principais: apps/api/src/totp.ts, apps/api/src/auth.ts, apps/api/src/routes/security.ts, apps/api/src/sso.ts, apps/api/src/routes/team.ts, apps/api/src/repo.ts, apps/api/src/repo-d1.ts, apps/api/src/schema.ts, apps/api/drizzle/0010_spotty_big_bertha.sql, apps/api/migrations-d1/0010_security.sql, apps/editor/src/pages/Security.tsx, apps/editor/src/pages/Login.tsx, e2e/tests/security.spec.ts
- Como testar manualmente: entrar como editor@abtest.dev → Configurar → Segurança → Configurar → adicionar a chave no app autenticador → código → guardar os códigos de recuperação; sair e entrar (pede o código). Em outra janela entrar de novo e, na primeira, "Sair de todos os outros". Como owner com TOTP: ligar "Exigir de todos os membros" e entrar como viewer (só a tela de ativação). `pnpm --filter @abtest/api exec vitest run src/totp.test.ts src/routes/security.test.ts`; `pnpm --filter @abtest/e2e e2e tests/security.spec.ts`.
- Observações: tokens emitidos antes desta versão (sem `sid`) deixam de valer: todos entram de novo uma vez. Em produção, o próximo `pnpm deploy:cf` aplica a migração 0010 no D1. Custo D1: +1 leitura por requisição autenticada e no máximo 1 escrita a cada 5 min por sessão. SSO só configura: falta implementar OIDC/SAML (D-073).

### 2026-10-20 05:05 — Tarefa 16.6 concluída (comentários e @menções)
- O que foi feito: tabela `comments` (alvo, nome do alvo, autor, texto, menções `[{ id, name }]` copiados na linha) nos dois bancos. Rotas `GET/POST /comments`, `DELETE /comments/:id` (quem escreveu ou owner) e `GET /comments/mentions`. Alvos: experimentos (todos os tipos de teste e campanha, no relatório), pop-ups (botão na lista, modal), pesquisas (relatório da pesquisa) e ideias da Otimização por IA (botão "Comentários" no cartão). Qualquer membro comenta, inclusive viewer; chave de API só lê. Menção: `@` abre a lista de membros (setas, Enter/Tab, clique); o servidor só aceita ids de membros da conta e grava o nome atual. Aviso: item "Menções" no menu com contador (padrão das Aprovações) e tela com links para o item comentado; webhook `mention`. Texto sempre renderizado como texto (menções só destacadas). Exclusão entra nas atividades do item.
- Arquivos principais: apps/api/src/routes/comments.ts, apps/api/src/repo.ts, apps/api/src/repo-d1.ts, apps/api/src/schema.ts, apps/api/drizzle/0011_aromatic_human_cannonball.sql, apps/api/migrations-d1/0011_comments.sql, apps/api/src/audit.ts, apps/editor/src/pages/Comments.tsx, apps/editor/src/shell.tsx, e2e/tests/comments.spec.ts
- Como testar manualmente: como demo@abtest.dev abrir o relatório de um teste, comentar com `@editor` e escolher "Editor Demo"; entrar como editor@abtest.dev (contador em Menções), abrir a menção. `pnpm --filter @abtest/api exec vitest run src/routes/comments.test.ts`; `pnpm --filter @abtest/e2e e2e tests/comments.spec.ts`.
- Observações: em produção, o próximo `pnpm deploy:cf` aplica a migração 0011 no D1. Sem edição de comentário nem e-mail (D-074). Comentários de item excluído ficam na tela Menções (o link leva a "não encontrado").

### Resumo da Fase 16 (confiança, governança e privacidade)
- Entregue: consentimento LGPD/GDPR no snippet com CMPs prontos (16.1), multi-conta com papel por conta, convites por link e conta nova (16.2), histórico de atividades por middleware (16.3), aprovação opcional de publicação (16.4), login em duas etapas, sessões revogáveis e base de SSO (16.5), comentários com @menções (16.6).
- Migrações novas no D1 (0007–0011) entram no próximo `pnpm deploy:cf`.
- Pendências da fase: SSO só configurado (falta OIDC/SAML, D-073); sem serviço de e-mail (convites copiados à mão, avisos só na tela e por webhook); snippet a 58 B do limite de 10 KB gzip (alvo es2020 libera ~440 B, D-069).

### 2026-10-20 05:18 — Tarefa 17.1 concluída (grupos mutuamente exclusivos)
- O que foi feito: entidade `group` (genérica, sem tabela nova nem migração): experimentos do grupo e a fatia de cada um (% do tráfego do grupo, soma até 100). A API valida (experimento existe na conta, não está em outro grupo, sem repetidos) e calcula a alocação em 100 fatias mexendo o mínimo na anterior (`allocateSlots`); ao publicar, cada experimento leva `group: { id, slots }` na config do site e no `sdk.json`. Snippet, SDK server-side e decisão do CDP usam a mesma regra (`inGroup` dentro de `chooseVariation`): fatia = `bucketOf(visitante, idDoGrupo) % 100`; fora da fatia não entra e a atribuição antiga é esquecida (não conta conversão). Tela Testes → Grupos exclusivos (barra de alocação, "Dividir igualmente", avisos de tráfego livre e de teste fora do ar, exclusão com confirmação) e etiqueta do grupo com a fatia na lista de experimentos. Criar/editar/excluir grupo entram nas atividades (regra genérica de entidades).
- Arquivos principais: packages/shared/src/entities.ts (GroupSchema, allocateSlots), packages/shared/src/experiment.ts, packages/snippet/src/bucket.ts, packages/snippet/src/runtime.ts, apps/api/src/routes/entities.ts, apps/api/src/publish.ts, apps/editor/src/pages/Groups.tsx, apps/editor/src/pages/Experiments.tsx, e2e/tests/groups.spec.ts
- Como testar manualmente: criar dois testes na mesma página com textos diferentes, iniciar; Testes → Grupos exclusivos → Novo grupo → adicionar os dois → Salvar e publicar; abrir o site demo em janelas anônimas: cada visitante vê só um dos testes, sempre o mesmo. `pnpm --filter @abtest/api exec vitest run src/routes/groups.test.ts`; `pnpm --filter @abtest/e2e e2e tests/groups.spec.ts`.
- Observações: snippet 10.236 B gzip (limite 10.240 B; coube sem mudar o alvo, ver "Bloqueios"). Tráfego efetivo de um teste no grupo = fatia × tráfego do próprio teste. Teste pausado mantém a fatia (fica sem teste) até sair do grupo (D-075).

### 2026-10-20 05:30 — Tarefa 17.2 concluída (teste multipágina / funil)
- O que foi feito: experimento ganha `pages` (funil: nome, URL aberta no editor e regra de URL) e cada operação ganha `page` (sem `page` = 1ª página, então testes antigos e operações feitas antes de virar funil continuam valendo). Sem migração: `pages` vai na coluna JSON `options` e `page` no JSON das operações, nos dois bancos. Ao publicar, `compileFunnel` troca as inclusões de URL da segmentação pelas regras das páginas (exclusões continuam) e grava a página explícita em toda operação; o snippet só acha a página atual (1ª regra que casa) e aplica as operações dela, mantendo a variação persistida do teste (mesma em todas as páginas); em SPA, trocar de página do funil reaplica. Editor: "transformar em multipágina" em Configurações (começa pela página aberta), barra "Funil" com as páginas (contagem de alterações, clicar abre a página no iframe), página fora do funil fica só em navegar com "Adicionar esta página ao funil"; lista de alterações, painel de propriedades e o agent recebem só as operações da página aberta; renomear/mudar regra/remover página em Configurações (remover leva as alterações dela; remover a última volta a página única com a regra dela). Exposição: o snippet emite em cada página do funil e o relatório já conta o visitante na 1ª exposição (1ª página do funil que ele vê).
- Arquivos principais: packages/shared/src/{experiment,operations}.ts, packages/snippet/src/{runtime,qa}.ts, apps/api/src/publish.ts, apps/editor/src/{store.ts,EditorView.tsx,components/SettingsPanel.tsx}, e2e/tests/multipage.spec.ts
- Como testar manualmente: abrir um teste no editor, Configurações → "transformar em multipágina", alterar o título da home; Navegar → "Comprar agora" → "Adicionar esta página ao funil" → Editar → alterar o título do produto; salvar, iniciar e publicar; no site demo (janela anônima) a home e o produto mostram as alterações da mesma variação. `pnpm --filter @abtest/e2e e2e tests/multipage.spec.ts`.
- Observações: snippet 10.192 B gzip (+28 B do funil, −72 B trocando o SVG do botão fechar do selo de QA por "✕"); alvo es2019 mantido. CSS/JS custom da variação valem em todas as páginas do funil (D-076).

### 2026-10-20 05:47 — Tarefa 17.3 concluída (link de pré-visualização)
- O que foi feito: botão "Link de pré-visualização" no editor (escolhe variação e validade de 1 h, 24 h, 7 dias ou 30 dias; salva antes se houver alteração; mostra o link uma vez com "Copiar"; lista os links ativos com "Revogar"). A API gera o token `<id>.<segredo>` (só o hash fica guardado, entidade `preview` fora das rotas genéricas, sem migração) e serve em `GET /preview/:conta/:token` o RASCUNHO do experimento compilado como na publicação (funil incluído), só com a variação do link, sem tráfego/audiências/grupo e com segmentação só de URL; customJS só se quem criou pode publicar JS. O snippet só detecta `?abt_preview=` (guardado na sessão, `off` sai) e carrega `preview.js` sob demanda, que esconde a página até 3 s, busca o rascunho, tira o token da URL, aplica com o runtime normal (sem coleta) e mostra o selo "Pré-visualização (rascunho)"; link inválido/expirado/revogado mostra aviso e sai do modo. Criar e revogar entram no histórico de atividades do experimento.
- Arquivos principais: apps/api/src/routes/previews.ts, apps/api/src/audit.ts, packages/snippet/src/{preview,qa,main,editor}.ts, packages/snippet/build.mjs, apps/editor/src/components/PreviewLinks.tsx, apps/editor/src/components/TopBar.tsx, e2e/tests/preview-link.spec.ts
- Como testar manualmente: abrir um teste no editor, alterar o título, "Link de pré-visualização" → Criar link; abrir o link numa janela anônima (vê a alteração sem publicar, navega pelo site mantendo o modo); Revogar e recarregar a janela (volta ao original com aviso). `pnpm --filter @abtest/api exec vitest run src/routes/previews.test.ts`; `pnpm --filter @abtest/e2e e2e tests/preview-link.spec.ts`.
- Observações: snippet 10.233 B gzip (+41 B; para caber, `sessionParam` passou a servir QA, edição e pré-visualização: chave do QA na sessão virou `_ab_force`); preview.js 7,7 KB gzip só para quem abre o link. Alvo es2019 mantido. Link expirado é coberto no teste da API (o E2E cobre revogado e token adulterado). D-077.

### 2026-10-20 05:57 — Tarefa 17.4 concluída (agendamento de iniciar/pausar)
- O que foi feito: agendamento de "iniciar" ou "pausar" em data/hora para qualquer experimento ou campanha (todos os tipos, inclusive server-side). Entidade interna `schedule` (sem tabela nem migração, fora das rotas genéricas) com experimento, ação, data em UTC e quem agendou; rotas `GET /schedules` (conta ou `?experimentId=`), `POST/PUT/DELETE /experiments/:id/schedules[/:sid]` (editor; data no futuro e até 1 ano; até 10 por teste; arquivado não agenda). Execução no job de hora em hora que já existia (`hourlyJobs`: cron único do Worker e `setInterval` do Node; nenhum cron novo): muda o status (nova versão com o autor do agendamento), apaga o agendamento, publica uma vez por conta e dispara o webhook `publish`. Aprovação (D-072): vale como aprovado se todos que agendaram aquela rodada ainda podem aprovar; senão a conta com aprovação recebe um pedido de "Agendamento" com o recado do que mudou (webhook `approval`). Atividades: criar/editar/cancelar com a pessoa; a execução como "Agendamento" (detalhe "agendado por Fulano · publicado na versão N"/"aguardando aprovação"). Editor: modal com ação + data/hora no fuso do navegador (passo de 1 h, aviso "até 1 h depois" e do fuso), lista com Editar/Cancelar; abre pelo menu da linha ("Agendar…"), pela etiqueta na lista, pelo botão na barra do editor (mostra o próximo) e na página server-side.
- Arquivos principais: apps/api/src/routes/schedules.ts, apps/api/src/bandit.ts, apps/api/src/audit.ts, apps/api/src/app.ts, apps/editor/src/components/Schedules.tsx, apps/editor/src/pages/Experiments.tsx, apps/editor/src/components/TopBar.tsx, apps/editor/src/pages/Activity.tsx, e2e/tests/schedule.spec.ts
- Como testar manualmente: Testes → menu "…" de um teste pausado → Agendar… → Iniciar na próxima hora; a etiqueta aparece na lista e no editor. No Node o job roda 1 h depois de a API subir e depois a cada hora (a execução com relógio controlado está no teste da API). `pnpm --filter @abtest/api exec vitest run src/routes/schedules.test.ts`; `pnpm --filter @abtest/e2e e2e tests/schedule.spec.ts`.
- Observações: precisão de hora em hora (cron `0 * * * *`; no Node o intervalo conta a partir de quando a API subiu). Editor aberto com o teste desde antes da execução pode sobrescrever o status ao salvar (mesmo caso dos pesos do bandit). Pop-ups e pesquisas não têm agendamento (D-078).

### 2026-10-20 06:12 — Tarefa 17.5 concluída (teste sequencial, CUPED e metas de guarda)
- O que foi feito: três opções por experimento em Configurações → "Estatística do relatório" (todas desligadas por padrão; experimentos existentes têm os mesmos números). **Teste sequencial** (mSPRT com mistura normal): p "sempre válido" e intervalo da melhoria que podem ser olhados a qualquer momento; com ele ligado, vencedora/perdedora exigem p < 5% (a chance bayesiana continua na tela e decide só o "liderando"). **CUPED**: covariável = páginas vistas pelo visitante nos 30 dias antes da 1ª exposição ao teste (até 5 s antes dela); novo visitante = 0; o relatório mostra a redução de variância obtida e usa o estimador ajustado no intervalo, melhoria, chances e p (a taxa exibida continua a observada); vale para taxa e receita por visitante. **Metas de guarda**: caixa "guarda" nas metas secundárias; variação "perdendo" numa delas (taxa ou receita) gera alerta no relatório, etiqueta "guarda" na linha, não pode ser vencedora na primária (vira "liderando"), sai do ar no piloto automático e vira achado crítico nos insights automáticos. As opções ficam na coluna `options` (sem migração) e não vão para a config publicada.
- Arquivos principais: packages/shared/src/{stats,experiment}.ts, apps/api/src/analytics/{report,insights}.ts, apps/api/src/routes/report.ts, apps/api/src/{bandit,publish}.ts, apps/editor/src/pages/Report.tsx, apps/editor/src/components/SettingsPanel.tsx, e2e/tests/{report,publish-flow}.spec.ts
- Como testar manualmente: no editor de um teste, Configurações → marcar "Teste sequencial", "CUPED" e "guarda" numa meta secundária; salvar; abrir o relatório (coluna "p sempre válido", nota do CUPED com a redução, alerta se a variação piorar a meta de guarda). `pnpm --filter @abtest/shared exec vitest run src/stats.test.ts` (simulação A/A com 20 olhadas); `pnpm --filter @abtest/api exec vitest run src/routes/report.test.ts`; `pnpm --filter @abtest/e2e e2e tests/report.spec.ts`.
- Observações: simulação (400 testes A/A, 20 olhadas de 500 por braço, semente fixa): falso positivo 0,5% com o sequencial vs 25,5% espiando o p-valor comum; poder com +20% de efeito 93% (vs 99,5%). CUPED custa uma consulta a mais (páginas vistas e exposições dos visitantes do relatório desde 30 dias antes do período) e O(n) de CPU, só no relatório com a opção ligada; o bandit/piloto automático e os insights não usam CUPED. Snippet inalterado (10.233 B). D-079.
