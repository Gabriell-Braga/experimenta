# Progresso
**Status:** em andamento
**Fase atual:** concluído
**Tarefa atual:** — (plano concluído)
**Última atualização:** 2026-10-14 08:33
**Próximo passo:** Plano concluído. Próximos passos sugeridos (fora do plano): integrar o /collect ao módulo de analytics da outra equipe (docs/EVENTOS.md), configurações por conta (amostragem do heatmap, origins), refresh token/SSO, reescrita de SameSite na extensão (ver Bloqueios), materialização/retenção dos eventos, deploy (Postgres real + CDN com purge).

## Bloqueios / perguntas para os humanos
- (não bloqueante) Extensão: não reescrevemos `SameSite` de cookies (limitação do declarativeNetRequest; ver D-024). Sites com login em cookie Lax/Strict podem deslogar dentro do iframe. Aprovar a permissão `cookies` para implementar a reescrita?
- (não bloqueante) Arquitetura: a config publicada vai embutida em `/cdn/<conta>.js` (D-008) em vez de só JSON buscado pelo snippet — necessário para anti-flicker por elemento síncrono. O `.json` continua publicado para integrações.

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
