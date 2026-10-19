# Decisões

Formato: contexto, opções, escolha, motivo.

## D-001 — Postgres sem Docker no ambiente de desenvolvimento
- Contexto: o plano pede docker-compose para o Postgres, mas a máquina de desenvolvimento atual não tem Docker instalado.
- Opções: (a) bloquear até instalarem Docker; (b) exigir Postgres nativo; (c) manter docker-compose.yml para quem tem Docker e usar PGlite (Postgres compilado para WASM, mesmo dialeto SQL) como fallback embutido quando `DATABASE_URL` não estiver definida.
- Escolha: (c).
- Motivo: Drizzle suporta os dois drivers com o mesmo schema; testes e `pnpm dev` funcionam sem infraestrutura externa; produção continua em Postgres real.

## D-002 — pnpm instalado via npm global
- Contexto: `corepack enable` falhou com EPERM em `C:\Program Files\nodejs`.
- Escolha: `npm i -g pnpm@9`. Versão fixada em `packageManager` no package.json raiz.

## D-003 — Pesquisa: premissas vs VWO/Optimizely (2026-10-14)
Fontes: help.vwo.com (artigos 360037883434, 360020440754, 900001789546), speedcurve.com/blog/web-performance-anti-flicker-snippets, docs da Adobe Target (Flicker Management), docs de extensões de Builder.io, Adobe Visual Editing Helper, Webtrends Optimize, Mida.
- **Confirmado — anti-flicker do VWO esconde a página inteira:** o SmartCode async esconde o `body` (campo `hide_element`), com `settings_tolerance` 2000 ms e `library_tolerance` 2500 ms. No timeout mostra o original e não rastreia. Nosso anti-flicker por elemento + timeout 1500 ms é diferencial real.
- **Diverge parcialmente — "por elemento" não é inédito:** Adobe Target (Flicker Management V2) pré-esconde só seletores extraídos das atividades. Continua sendo diferencial frente a VWO/Optimizely, não frente a todo o mercado.
- **Confirmado — extensão para iframe bloqueado:** padrão de mercado (Adobe Visual Editing Helper, Builder.io, Webtrends, Mida) remove X-Frame-Options e CSP frame-ancestors. Adobe e Builder.io também ajustam `SameSite` dos cookies para o login do site funcionar dentro do iframe. **Adição ao plano:** a extensão (5.1) também reescreverá `SameSite=None; Secure` em Set-Cookie apenas nas sessões de edição, senão sites com login quebram no iframe. Builder.io limita a reescrita ao contexto do próprio app, mesma ideia do nosso "só sessões iniciadas pelo app".
- **Confirmado — snippet síncrono no `<head>`:** recomendação de VWO e Optimizely para reduzir flicker. Nosso snippet deve ser instalado como primeiro script do head; o `<style>` anti-flicker é injetado de forma síncrona.
- **Não verificado:** documentação oficial do Optimizely sobre timeout padrão (fontes de terceiros divergem: 1–3 s). Não afeta o plano.

## D-004 — Contrato em packages/shared
- Operações: união discriminada por `type`; `move` e `insertHTML` usam `position` before/after/prepend/append (prepend/append = "dentro"). `move.value.anchor` é um Target completo (também cura).
- Experimento referenciado por `key` legível (usado em `ab_force=chave:variacao`) e `id` interno; a primeira variação é o controle; pesos inteiros relativos.
- Snippet só faz `import type` de shared (zod fica fora do bundle de 10 KB). A validação forte acontece na API e no editor; o snippet confia no JSON publicado.
- Eventos de tracking têm `eventId` para deduplicação no analytics.

## D-005 — Resolução de alvo
- Cada operação age sobre UM elemento (o primeiro que casa). Motivo: a impressão digital e a cura só fazem sentido para um elemento; mudanças em listas usam customCSS ou uma operação por item.
- Cura por impressão digital: varre elementos da mesma tag, pontua texto exato (+3), texto parcial (+1), atributos (id/data-* +2, demais +1), posição (<50 px +1, <200 px +0,5). Aceita só com pontuação ≥ 3 e vantagem ≥ 1 sobre o 2º colocado (evita curar para o elemento errado).
- O seletor curado relatado no evento é um caminho nth-of-type curto (ancorado em id), gerado no próprio snippet — o gerador completo fica fora do bundle.

## D-006 — Motor de operações (packages/snippet/src/engine)
- Fica no pacote do snippet (export `@abtest/snippet/engine`) porque é o código de runtime; o agent importa o mesmo motor para pré-visualizar ao vivo — uma única implementação.
- Cada aplicação devolve `undo`; `ApplyHandle.revert()` desfaz tudo em ordem inversa. O editor usa isso para trocar de variação e desfazer sem recarregar a página.
- `setStyle`/`hide` usam `!important` inline para vencer o CSS do site. `hide` = `display:none`; `remove` remove o nó de fato.
- O timeout de espera por elementos conta a partir do DOMContentLoaded (o snippet roda no `<head>`, antes do body existir).
- O observer é desconectado enquanto aplicamos, para nossas próprias mutações não dispararem nova rodada.

## D-007 — Modo `persist` no motor
- Contexto: em SPAs (React/Vue), re-render pode substituir o nó alvo depois da aplicação, apagando a variação.
- Escolha: opção `persist` mantém o MutationObserver ativo e aplica a operação em qualquer nó novo que o alvo resolva (WeakSet evita reaplicar no mesmo nó). O snippet usa `persist: true`; para ao trocar de rota/variação.
- Limitação conhecida: se o framework alterar o conteúdo do MESMO nó (sem trocá-lo), a operação não é reaplicada.

## D-008 — Configuração embutida no JS da conta (estilo Optimizely)
- Contexto: anti-flicker por elemento exige conhecer os seletores ANTES do primeiro paint. Buscar um JSON via fetch é assíncrono — no primeiro acesso não daria para esconder só os elementos, teríamos de esconder a página (o que o VWO faz).
- Opções: (a) snippet genérico + fetch do JSON (esconde página até chegar); (b) XHR síncrono (obsoleto, bloqueia); (c) publicar `/cdn/<conta>.js` = `window.__ABT_CONFIG__ = {...};` + runtime, carregado com um único `<script>` síncrono no `<head>`.
- Escolha: (c). A publicação grava também `/cdn/<conta>.json` (contrato para integração/analytics).
- Cache: o arquivo é servido com `Cache-Control: max-age=60` + ETag; publicar sobrescreve o arquivo e incrementa `version` (numa CDN real, publicar dispara purge do caminho).
- Instalação no site: `<script src="https://<cdn>/cdn/<conta>.js"></script>` como primeiro script do `<head>`.
- Limite de 10 KB gzip vale para o runtime; a config embutida é medida à parte.

## D-009 — Bucketing
- Um único hash: `b = murmurhash3(visitorId + experimentId) % 10000`. Entra se `b < traffic × 100`; dentro dessa faixa, `b / faixa × somaPesos` escolhe a variação. Determinístico e independente entre experimentos (o id entra no hash).
- Persistência em localStorage `_abt_a` (experimentId → variationId). Visitante fora do tráfego não é persistido: se o tráfego aumentar, pode entrar depois; quem já entrou mantém a variação mesmo com mudança de pesos. Variação removida → nova atribuição.
- Bots por User-Agent são ignorados (não entram em experimento nem geram eventos). HeadlessChrome não é tratado como bot (testes E2E).

## D-010 — Anti-flicker e teste por frames
- CSS: uma regra por seletor `:is(<sel>):not([data-abt-ok]){visibility:hidden!important}`; ao aplicar a operação o elemento recebe `data-abt-ok` e reaparece. `:is()` isola listas de seletores; regra por seletor evita que um seletor inválido anule os demais. Modo página: `html{opacity:0!important}`.
- Timeout de segurança conta do início do snippet (padrão 1500 ms); no fim (tudo aplicado ou timeout) o `<style>` é removido.
- Teste E2E: (1) script de init amostra em cada requestAnimationFrame a visibilidade/conteúdo dos elementos; (2) CDP `Page.startScreencast` captura os frames realmente pintados (PNG) e o teste conta pixels da cor original do botão na região dele — deve ser zero em todos os frames. Há um controle negativo que prova que a amostragem detecta flicker.
- Variação de controle (sem operações) não esconde nada.

## D-011 — SPA
- `history.pushState`/`replaceState` são envolvidos e `popstate` é ouvido; a cada mudança real de URL o runtime reavalia: experimentos que deixaram de casar são revertidos (`revert` do motor + remoção de customCSS), os novos são ativados (com anti-flicker por elemento), os que continuam ativos seguem com o observer `persist`.
- `exposure` é emitido a cada ativação (primeira carga ou reentrada na rota segmentada), não a cada navegação.

## D-012 — Eventos, metas e QA
- Transporte: sendBeacon com `text/plain` (sem preflight CORS), lote a cada 1 s, flush imediato em conversão e no pagehide/visibilitychange. Conversão envia na hora porque costuma preceder navegação (beacons disparados durante o unload são menos confiáveis).
- Conversões são atribuídas a todos os experimentos em que o visitante está (atribuições persistidas), não só aos ativos na página — a meta costuma estar em outra URL.
- Modo QA (`?ab_force=exp:var`) ignora segmentação/tráfego, não persiste atribuição, fica salvo na sessão (`?ab_force=off` limpa) e marca eventos com `qa: true` em vez de suprimi-los (o analytics filtra; facilita depurar a integração).
- Integração sem código: `CustomEvent('abt:event')` no window e adaptadores via `abq.push(['adapter', fn])`.

## D-013 — Protocolo RPC app ↔ agent
- Envelope `{abt:1, kind:'req'|'res'|'evt'}` sobre postMessage; os dois lados podem chamar métodos e emitir eventos (`createPeer`).
- Segurança: `origin` exato obrigatório (nunca `'*'`), usado como targetOrigin no envio e conferido junto com `event.source` em toda mensagem recebida. Parâmetros, resultados e eventos são validados com zod; mensagens inválidas são ignoradas.
- Contrato em `packages/shared/src/rpc.ts`: agent expõe `ping`, `setMode`, `applyVariation` (sempre a lista COMPLETA de operações: o agent reverte e reaplica, simples e sem estado divergente), `select`, `highlight`; app expõe `prompt` (pedir HTML/URL de imagem ao usuário); agent emite `ready`, `selected`, `operation` (rascunho sem id/ordem — o app numera), `navigated`.

## D-014 — Handshake do modo edição
- Três condições (plano): `?abt_edit=<token>` + token validado na API (emitido para a mesma conta; a API devolve o `appOrigin` que criou a sessão) + handshake postMessage com origin exato. O origin do app NUNCA vem da URL (um atacante poderia apontar para o próprio domínio) — vem da sessão na API.
- O `hello` do snippet usa targetOrigin = appOrigin: uma página maliciosa que emoldure o site com um token roubado nem recebe a mensagem. O `hello-ack` precisa vir de `window.parent`, do appOrigin e ecoar o token.
- Só dentro de iframe (`parent !== window`); o token fica no sessionStorage do iframe (particionado pelo site de topo no Chrome) para sobreviver à navegação no modo "navegar".
- Sessões em memória na API (ponytail: mover para banco/Redis com múltiplas instâncias). Criação restrita por CORS + checagem do header Origin contra `EDITOR_ORIGINS`; autenticação de usuário entra na 4.2.
- O agent é carregado da mesma pasta do script da conta (`new URL('agent.js', currentScript.src)`), sem config extra.

## D-015 — Agent: overlay e captura de eventos
- UI do agent num custom element `<abt-editor-overlay>` filho de `<html>` (fora do body, não entra nos caminhos nth-of-type), com Shadow DOM e `:host{all:initial}`; caixas com `pointer-events:none`, só o breadcrumb recebe cliques.
- No modo edição, listeners em captura no window bloqueiam click/mousedown/pointer/submit/dblclick/contextmenu do site (`stopImmediatePropagation`) — o site não navega nem reage. Eventos vindos do overlay (`composedPath`) passam.
- Navegação no modo "navegar" recarrega a página no iframe; o snippet refaz o handshake e o agent emite `ready` de novo — o app trata `ready` como (re)conexão e reenvia modo + variação.
- Seletor sugerido segue a prioridade do pacote selector (atributos semânticos como `href` vêm antes de classes).

## D-016 — Interações de edição no agent
- O agent nunca altera o DOM de forma definitiva: edição inline, arrastar e menu de contexto geram RASCUNHOS de operação (`operation`); o app numera, guarda e chama `applyVariation` com a lista completa. Ao confirmar a edição inline o agent restaura o original — a mudança volta pela variação. Fonte única da verdade = lista de operações no app (desfazer/refazer triviais).
- Edição inline: duplo clique → `contenteditable`; Enter/blur confirma, Shift+Enter quebra linha, Esc cancela. Sem filhos elemento → `setText`; com filhos → `setHTML`.
- Arrastar: alça (⠿) ao lado do rótulo do selecionado; usa pointer events + `elementsFromPoint`; faixa superior 25% = antes, inferior 25% = depois, meio = dentro (exceto elementos vazios/void). Listeners de arraste registrados antes do bloqueio de eventos (que usa stopImmediatePropagation).
- Inserir HTML e trocar imagem pedem o valor ao app via RPC `prompt` (o diálogo fica fora do iframe).

## D-017 — App do editor
- Estado com `useReducer` puro (testável sem React) em vez de lib de estado: experimento, variação ativa, histórico (100 passos) com desfazer/refazer; trocar de aba não entra no histórico.
- Modos: Editar (agent intercepta), Navegar (site interativo, variação aplicada, navegação real no iframe com reconexão automática), Preview (como Navegar, sem painéis e com faixa indicando a variação). "Preview" não abre nova aba com `?ab_force` porque o rascunho ainda não está publicado.
- Dispositivo = largura do iframe (100% / 768 px / 390 px). O User-Agent não muda — segmentação por dispositivo depende de UA e não é simulada no editor.
- Salvar grava em localStorage até a fase 4 (API). Ctrl+Z / Ctrl+Shift+Z / Ctrl+S no app.

## D-018 — Painel de propriedades
- Cada elemento tem no máximo UMA operação `setStyle` (as propriedades fazem merge), uma `setText` e uma `setAttribute` por nome — `upsertOperation` no store localiza a equivalente (mesmo seletor + tipo [+ nome do atributo]). Mantém a lista de alterações curta e legível.
- Campos de texto confirmam no Enter/blur (uma operação por edição, não por tecla). O seletor de cor usa `coalesceKey`: arrastar no picker gera uma única entrada no histórico.
- Valor exibido = valor da variação, se houver; senão o estilo computado enviado pelo agent na seleção. Borda é editada pelos atalhos `border-width/style/color` (exibe o lado superior).
- Indicador de fragilidade (estável/médio/frágil) já aparece no painel (base para 6.2).

## D-019 — Lista de alterações e código custom
- Barra lateral com abas Elemento / Alterações / CSS-JS. A lista mostra cada operação em ordem de aplicação com descrição legível, destaca o alvo no site ao passar o mouse (`highlight`), seleciona ao clicar, reordena (↑/↓) e exclui. Operações que não acharam o elemento na página atual ficam em vermelho e a aba mostra ⚠N (base do "alerta quando uma alteração não encontra o elemento"); curadas por alternativo/impressão digital ficam em amarelo.
- Monaco empacotado localmente (`monaco-editor` + workers via `?worker` do Vite, sem CDN) e carregado sob demanda (`React.lazy`) — o chunk é grande, mas só baixa ao abrir a aba de código.
- customCSS aplica ao vivo. customJS só executa no editor quando o usuário marca "Executar o JS no editor" (roda na página real do cliente). A permissão de PUBLICAR customJS fica na API (4.2).

## D-020 — Modelo de dados
- Tabelas: accounts, users (role owner/editor/viewer + `can_publish_js`, senha scrypt), projects (site), experiments (segmentação/anti-flicker em jsonb), variations (operações em jsonb — lista de operações, nunca HTML), goals (definição jsonb validada pelo zod), experiment_versions (snapshot completo a cada salvamento), publications (config publicada, só inserção).
- `account_id` em todas as tabelas de tenant, com índice; chave do experimento única POR CONTA. O repositório não expõe nenhuma consulta de tenant sem `accountId`; tentativa de gravar id de experimento de outra conta ou em projeto de outra conta → NotFoundError (não revela existência).
- Salvar = substituir variações e metas do experimento numa transação (simples; o volume por experimento é pequeno) + nova versão.
- Migrações versionadas com drizzle-kit e aplicadas no start (`migrate`), mesma pasta para PGlite e Postgres.

## D-021 — API, autenticação e permissões
- `@hono/zod-openapi`: as rotas são declaradas com os MESMOS schemas zod de `packages/shared` → validação e OpenAPI 3.1 (`/openapi.json`, Swagger em `/docs`) sem duplicar contrato.
- Autenticação por JWT HS256 (12 h) emitido em `/auth/login` (senha scrypt). O middleware recarrega o usuário do banco a cada requisição (papel atualizado, usuário removido perde acesso) e a conta vem do token — nunca do corpo. Login social/SSO e refresh token ficam para depois.
- Papéis: viewer (lê), editor (cria/salva/abre sessão de edição/publica), owner (tudo). Publicar customJS exige owner ou `can_publish_js` (checado na publicação, 4.3). Recursos de outra conta respondem 404 (não revelam existência).
- CORS: rotas privadas só aceitam os origins do editor (`EDITOR_ORIGINS`); `/cdn/*`, `GET /edit-sessions/:token` e coleta de eventos são públicas.
- O editor deixa de usar localStorage para o experimento: login → lista → `?exp=<id>`; salvar = PUT (nova versão). Seed de desenvolvimento com conta `demo` e um usuário de cada papel.

## D-022 — Publicação e coleta
- `POST /publish` (editor+) compila os experimentos com status `running` da conta num `PublishedConfig` versionado (última versão + 1), registra em `publications` (só inserção — histórico imutável) e grava `/cdn/<conta>.json` e `/cdn/<conta>.js`. Publicar = sobrescrever os arquivos (numa CDN real: + purge do caminho).
- Regra do customJS: sem permissão (`owner` ou `can_publish_js`), a publicação é recusada (403) se algum customJS em execução for NOVO ou DIFERENTE do que já está publicado; republicar JS idêntico (aprovado antes) é permitido, para editores poderem publicar outras mudanças.
- `POST /collect` público (CORS `*`, text/plain, até 64 KB e 200 eventos por lote): valida cada evento com o schema, ignora inválidos e contas inexistentes, deduplica por `eventId` (`ON CONFLICT DO NOTHING`), guarda em `events` para o painel de saúde. Responde 204 sem detalhes. Sem rate limit (ponytail).

## D-023 — Configurações e publicação no editor
- Aba "Config": nome, status, tráfego (%), pesos por variação (mostra %), regras de URL (é/contém/regex + excluir) e metas (clique, visita a URL, formulário, evento custom; chave gerada do nome). Tudo passa pelo reducer (desfazer/refazer).
- "Publicar" salva o experimento e publica a CONTA inteira (a config por conta é um arquivo só). Se o experimento atual não está "Em execução", o aviso diz que ele não entra na publicação.
- E2E usa a CDN real da API (`e2e/.cdn`, limpa a cada execução por `e2e/reset-cdn.mjs`) — o visitante do teste carrega snippet + config exatamente como em produção.

## D-024 — Extensão Chrome MV3
- Ponte: content script `bridge.js` injetado SÓ nos origins do editor (manifest gerado com `EDITOR_ORIGINS`) faz window.postMessage ↔ service worker. O app não precisa saber o ID da extensão e nenhuma outra página consegue abrir sessão (o SW só aceita `start` do frame principal de uma aba onde a ponte rodou).
- Regras `declarativeNetRequest.updateSessionRules` por sessão: condição `tabIds:[aba do editor]` + `resourceTypes:['sub_frame']` + regex do origin exato do site; ação remove `X-Frame-Options`, `Content-Security-Policy` e `-Report-Only` (DNR não edita diretivas). Nada muda na navegação normal do usuário nem em outras abas. Sessão expira em 15 min, fecha com a aba ou quando o editor sai (`end`). Estado em `chrome.storage.session` (o SW pode morrer).
- Injeção: content script em todos os frames só age dentro de iframe com `abt_edit` E se o SW confirmar sessão para aquela aba+origin. Se o site não tem o snippet (marca `data-abt-editor` ausente), injeta o script da conta (`<apiUrl>/cdn/<conta>.js`), que faz o handshake normal (token na API + origin exato) e carrega o agent — mesma segurança do caminho com snippet.
- Editor: se o snippet não responder em 5 s, tenta a extensão automaticamente (ping → start → recarrega o iframe); sem extensão, mostra aviso para instalar.
- **Diverge de D-003:** `SameSite` de cookies NÃO é reescrito — DNR só consegue remover/definir o header `Set-Cookie` inteiro, não seus atributos. Sites com login em cookie `SameSite=Lax/Strict` podem não manter a sessão dentro do iframe. Alternativa futura: `chrome.cookies` para reescrever os cookies do domínio durante a sessão (exige permissão `cookies`).

## D-025 — Saúde dos seletores
- `GET /experiments/{id}/health` agrega a tabela `events` (filtrada por conta e experimento): exposições por variação e, por operação, contagem de `selector_failed`/`selector_healed`, último seletor curado (+via) e última ocorrência — uma consulta SQL com `count(*) filter` e `array_agg ... order by ts desc`.
- Editor, aba "Saúde": por alteração da variação ativa mostra OK / falhou N× (taxa sobre exposições) / curado N× com o seletor usado. "Adotar este seletor" troca o seletor principal pelo curado e rebaixa o antigo para alternativo (mantém a cura possível se o site voltar atrás). Depois é preciso salvar e publicar.

## D-026 — Aviso de seletor frágil
- `selectorFragility(selector)` (packages/selector) avalia qualquer seletor só pelo texto (inclusive os editados/adotados): `high` se usa nth-* ou id/classe com cara de gerada; `low` se ancorado num id/data-* estável sem combinadores ou classe estável simples; `medium` no resto.
- Três pontos de aviso no editor: dica no painel ao selecionar elemento frágil, faixa amarela ao criar uma alteração frágil (com sugestão de pedir `data-testid`) e ⚠ na lista de alterações. Não bloqueia: a impressão digital ainda tenta curar.

## D-027 — Conflito entre experimentos
- `GET /experiments/{id}/conflicts` (apps/api/src/conflicts.ts): outros experimentos não arquivados da conta que alteram o mesmo elemento — compara seletor principal + alternativos normalizados (espaços nos combinadores) de todas as variações.
- Sobreposição de páginas aproximada: a página de referência (editorUrl) de um casa com a segmentação de URL do outro, em qualquer sentido (regras vazias = todas), e os dispositivos não são disjuntos. Não tenta provar interseção de regex — falso positivo é aceitável (é aviso), falso negativo raro.
- Editor: faixa ⚔ na aba Alterações + marca por alteração; ao Publicar, avisa se o conflito é com experimento em execução. Não bloqueia (às vezes é intencional, ex.: experimentos mutuamente exclusivos por segmentação de público que a heurística não enxerga).

## D-028 — Versões e restauração
- Toda gravação já gera um snapshot completo (D-020). Restaurar = gravar o snapshot escolhido como NOVA versão (v1 → restaurada como v3): o histórico é append-only, dá para "desfazer a restauração" restaurando a v2.
- `GET /experiments/{id}/versions/{v}` devolve o snapshot; `POST .../restore` exige editor. Restaurar não publica — publicar continua sendo ação explícita.
- Editor: aba "Versões" com confirmação em dois cliques (sem diálogo nativo) e aviso de alterações não salvas; após restaurar recarrega o experimento.

## D-029 — Captura para mapa de calor (snippet)
- Ligado pela config publicada (`heatmap.sampleRate`; hoje global via `HEATMAP_SAMPLE_RATE`, padrão 1 em dev). Amostragem determinística por visitante (`murmurhash3(visitorId + ':heatmap')`), nunca em modo QA.
- Clique: seletor curto do elemento clicado (`pathOf`, ancorado no id mais próximo) + posição RELATIVA dentro do elemento (rx, ry 0..1) + coordenadas de página e viewport. Desenhar pela posição relativa ao elemento sobrevive a layouts responsivos e conteúdo dinâmico (melhor que só px/py).
- Scroll: profundidade máxima (% da altura da página), um evento por página vista — no `pagehide` e a cada navegação de SPA (com a URL antiga); força flush do lote.
- Cada evento leva `device` e `variations` (experimentos ATIVOS na página → variação) para filtrar o mapa por variação e dispositivo. Mesmo transporte (lote/sendBeacon) e endpoint `/collect`; o schema `TrackingEventSchema` ganhou os tipos `click` e `scroll` (`HeatmapEvent`).
- Runtime: 7,2 KB gzip.

## D-030 — Agregação do mapa de calor
- `GET /heatmap` agrega direto da tabela `events` em SQL (normaliza a URL em SQL igual ao `normalizePage` do Node), cliques por seletor com até 200 pontos (os mais recentes) por elemento, e alcance de scroll em faixas de 10%. Filtros: variação (`payload.variations[experimentId] = variationId`), só experimento (presença da chave) e dispositivo.
- ponytail: agregação na leitura, sem tabela pré-agregada nem retenção; com volume real, materializar por dia/página e expurgar eventos crus antigos.

## D-031 — Overlay do mapa de calor no agent
- O mesmo agent do editor desenha o mapa sobre o site REAL (diferencial do plano): RPC `showHeatmap(dados)` / `hideHeatmap`. O app busca `/heatmap` da URL aberta com os filtros (variação → `experimentId`+`variationId`; dispositivo) e envia os dados; a cada navegação (`ready`) reenvia.
- Canvas no Shadow DOM, do tamanho da viewport (× devicePixelRatio), redesenhado em scroll/resize: cada ponto = retângulo atual do elemento + (rx, ry); acumula gradientes radiais no alfa e coloriza (azul→verde→amarelo→vermelho). Badge com contagem (e % no título) por elemento; linhas de scroll em `depth% × altura do documento` com "% chegaram aqui". Seletores que não existem na página atual são contados e informados no painel.
- No modo "Mapa de calor" o agent fica em modo navegar (sem interceptar cliques) e a página continua com a variação da aba ativa aplicada; para o layout bater com o dos visitantes, filtre pela mesma variação da aba.

## D-032 — Deploy na Cloudflare (Workers + D1 + KV)
- Contexto: pedido de colocar tudo online na Cloudflare; sem Docker na máquina e sem Postgres gerenciado disponível na conta (Hyperdrive exigiria um Postgres externo).
- Escolha: API como Worker com **D1 (SQLite)** e **KV** como CDN; editor e demo como Workers de arquivos estáticos (o wrangler atual direciona Pages para Workers com assets). O caminho Postgres/Node continua para dev e self-host.
- Para não divergir: o repositório tem duas implementações do MESMO contrato (`createRepo` Drizzle/Postgres e `createD1Repo` SQL SQLite) e a suíte da API roda contra as duas (`vitest.config.ts`, D1 simulado com `node:sqlite`). Senhas passaram para PBKDF2 via Web Crypto (roda nos dois runtimes; Workers limita a 100 mil iterações). Sessões de edição no D1 (isolates não compartilham memória). CDN atrás da interface `CdnStore` (pasta local ou KV).
- D1 não tem transação interativa: `saveExperiment` valida antes e grava num `batch` atômico. SQLite não tem `regexp_replace`: a página normalizada do evento vira coluna `page` na inserção.
- Usuários da conta demo em produção usam a senha do segredo `SEED_PASSWORD` (não `demo1234`).

## D-033 — Respostas às perguntas abertas
- **Config embutida no JS (D-008): mantida.** É o que permite o anti-flicker por elemento sem esconder a página; o `.json` continua publicado para o analytics. Custo aceito: um arquivo por conta e cache de 60 s após publicar.
- **SameSite na extensão: implementar** com a permissão `cookies` — durante a sessão de edição, cookies do site com SameSite Lax/Strict passam a `None; Secure` e são restaurados ao fim da sessão (ver D-034).

## D-034 — SameSite na extensão (resolve a pergunta de D-024)
- Permissão `cookies`. Ao abrir a sessão de edição, os cookies do site com SameSite Lax/Strict passam a `None; Secure` (só onde Secure é aceito: https, localhost, 127.0.0.1); cookies criados durante a sessão (ex.: login numa aba normal) também (`cookies.onChanged`). O SameSite/Secure original fica guardado na sessão e é restaurado quando a sessão termina (aba fechada, `end` ou expiração), preservando o valor atual do cookie.
- Com a extensão instalada o editor abre a sessão ANTES de carregar o iframe (não espera os 5 s): headers e cookies já liberados.
- Limites: login feito DENTRO do iframe em site que responde `Set-Cookie` Lax continua sendo recusado pelo navegador (o cookie nem chega a existir) — logar no site numa aba normal resolve. Duas abas de editor no mesmo site: fechar uma restaura os cookies da outra (raro; aceito).
- Teste: demo `cookie.html` em 127.0.0.1 (outro site em relação ao editor em localhost) — sem extensão aparece "deslogado", com extensão "logado", e o SameSite volta a Lax ao fechar o editor.

## D-035 — Performance em produção e UX do app (pós-plano)
- Medido em produção (Worker em GRU, D1 longe): salvar ~1 s, conflitos ~2,5 s, publicar ~3,6 s — o botão Publicar encadeava salvar + conflitos + publicar (~7 s). Causas: cada consulta ao D1 cruza o continente e `loadAllRecords` fazia 3 consultas POR experimento. Correções: leituras agrupadas em `d1.batch` (todos os experimentos em 3 consultas; validações do salvar em 1 ida), gravações na KV em paralelo, runtime em memória no isolate, Smart Placement no Worker, e o editor só salva se houver mudança e calcula conflitos em segundo plano. Resultado medido: salvar ~0,5 s, conflitos ~0,35 s, publicar ~1 s.
- UX: componentes próprios leves (Tailwind, sem biblioteca): botões com estado de carregamento, toasts (sucesso/erro/info com ação "Ver no site"), modal sobre `<dialog>`, badges de status, skeletons. Login em duas colunas; lista em tabela com filtros por status, busca, contadores, tráfego, tempo relativo e ações rápidas (iniciar, pausar, duplicar, arquivar, excluir com confirmação) — novas rotas `PATCH /experiments/{id}/status` e `POST /experiments/{id}/duplicate` (duplicar gera ids novos inclusive das operações, que o snippet usa para idempotência). Criação por modal com nome e página (atalhos Home/Loja/SPA). Editor: barra em duas linhas, renomear inline, indicador "Salvando…/Alterações não salvas/Salvo há X", Ctrl+S, aviso ao sair com mudanças (modal + beforeunload), overlay "Conectando ao site…".
- Segmentação × página editada: se a segmentação ainda é a padrão (só a página inicial), ela acompanha a página digitada no editor; senão aparece alerta "esta página não está na segmentação" com "Incluir esta página". A URL atual passa a vir do agent a cada `ready` (navegação por link) sem recarregar o iframe.
- Achado pelo site complexo (`/loja/`): `data-product-id="1"` era tratado como token gerado (começa com dígito) e o editor caía em seletor por posição; ids numéricos curtos em `data-*` agora são estáveis.

## D-036 — Ícones em vez de emojis
- Interface sem emojis nem símbolos tipográficos decorativos. Editor usa `lucide-react` (só os ícones importados entram no bundle); onde não há React (alça de arrastar do agent, selo de QA do snippet, loja de demonstração) usamos os SVGs do mesmo conjunto (Lucide) inline, com `currentColor` e `aria-hidden`.

## D-037 — Reaplicação em modo persist e configurações fora da edição
- Bug: no modo `persist` (snippet e agent) cada mutação do DOM re-resolvia todos os seletores e aplicava a operação em qualquer elemento ainda não processado. Seletores por posição/classe passam a casar com nós inseridos ou movidos pela própria variação: `insertHTML` antes do alvo duplicava o bloco, `remove` removia em cadeia, `move` movia o vizinho e o elemento "não ficava".
- Regra nova: cada operação lembra o último elemento em que foi aplicada; enquanto ele segue conectado, não é reaplicada. Só re-resolve quando o elemento sai da página (re-render do framework). `remove` tira o próprio alvo: só reaplica se o elemento novo tiver o mesmo `outerHTML` do removido (re-render idêntico).
- Edição inline/“Editar HTML” capturam o innerHTML sem os nós `data-abt-inserted` (copiá-los gerava a duplicação na própria setHTML).
- Configurações (status, tráfego, pesos, páginas, metas) viraram janela própria aberta pela barra superior: separadas da edição visual, como pedido. A meta de clique/formulário pode ser escolhida clicando no site (o próximo elemento selecionado preenche o seletor).

## D-038 — Amostragem do mapa de calor por conta
- Por conta, não por experimento: a captura de cliques/scroll não pertence a um experimento (ver D-029) e o custo de eventos é da conta. `accounts.heatmap_sample_rate` (0..1, NULL = padrão do servidor `HEATMAP_SAMPLE_RATE`); só owner altera; vale a partir da próxima publicação (a taxa vai na config publicada).

## D-039 — Retenção dos eventos crus e rotas de SPA
- Expurgo por `received_at` (não `ts`, que vem do relógio do visitante), `EVENTS_RETENTION_DAYS` (padrão 90). É a única consulta sem filtro de conta, de propósito: manutenção do sistema, sem rota exposta. Worker: cron diário em `wrangler.jsonc`; Node: ao subir + `setInterval` de 24 h.
- ponytail: DELETE sem índice em `received_at` (varredura diária); criar índice quando a tabela crescer. Pré-agregação do heatmap por dia/página continua adiada.
- SPA: além de patch em pushState/replaceState e `popstate`, ouve `hashchange` e `navigation.currententrychange` (Chromium) — cobre routers que guardaram o `pushState` original antes do snippet (snippet via tag manager). Lembrete: no editor, modo "Editar" bloqueia cliques do site; para trocar de rota use "Navegar".


## D-040 — Identidade visual própria e moldura por módulos (fase 9)
- Pedido: "menos cara de vibecode e mais personalidade". Direção "caderno de laboratório": papel quente (`paper`), tinta (`ink`) no menu lateral e na barra do editor, verde de laboratório como cor da marca e lima como marca-texto (estado ativo, vencedor, botão Publicar). Títulos em serifa (Fraunces), UI em Inter Tight, números/chaves/seletores em JetBrains Mono (`@fontsource-variable`, empacotadas — sem chamada a Google Fonts). Cantos menores (4–8 px), bordas finas de tinta translúcida em vez de sombras, etiquetas mono em caixa alta, fundo quadriculado em estados vazios e no canvas do editor. Logo: frasco dividido ao meio (controle | variação).
- Os neutros `gray-*` do Tailwind foram redefinidos para tons quentes no `@theme`: telas antigas herdam a paleta sem trocar classes.
- Navegação inspirada no VWO (menu lateral por módulo: Testes, Insights, Engajamento, Dados, Configurar), mas cada item só entra quando a tela existe. Roteamento por query string (`?view=`; `?exp=` continua abrindo o editor): sem fallback de rota no Worker de arquivos estáticos.

## D-041 — Coleta de dados e analytics em memória (fase 9.2)
- `pageview`, `event` e `identify` vão para **todos** os visitantes (não amostrados): funis, jornadas, coortes, perfis e CDP precisam do caminho completo. Capturas pesadas (cliques, scroll, mouse, formulários, gravação) seguem amostradas pela taxa da conta.
- Sessão = cookie first-party `_abt_sid` renovado a cada página, expira após 30 min sem atividade (mesmo critério de GA/VWO). Perfil local enxuto em `localStorage._abt_p` (chaves curtas): base da segmentação comportamental (13.1) sem ida ao servidor.
- Analytics: o repositório ganhou só uma consulta genérica (`listEvents` com filtros por tipo, período, experimento, sessão, visitantes e página) nas duas implementações (Postgres/D1); toda agregação é TypeScript puro em `apps/api/src/analytics/*` — uma implementação, testada contra os dois bancos. Colunas `visitor_id`/`session_id` + índices `(account, ts)`, `(account, session)`, `(account, visitor)`.
- ponytail: agregação na leitura com teto de 50 mil eventos por consulta (`EVENT_LIMIT`). Quando o volume passar disso: pré-agregar por dia/página num job (cron) e ler os agregados. D1 limita a 100 parâmetros: listas de visitantes vão em lotes de 80.
- Rotas novas ficam em `apps/api/src/routes/<módulo>.ts` (o `app.ts` já passava de 700 linhas); peças comuns em `src/http.ts`.

## D-042 — Motor estatístico (fase 9.3)
- Bayesiano como padrão da interface (como o SmartStats do VWO): taxa de conversão com posterior Beta(1+conv, 1+não-conv) e receita por visitante com posterior Normal(média, s²/n). Probabilidade de vencer o controle, de ser a melhor, perda esperada e intervalos de 95% saem de 20 mil amostras Monte Carlo com PRNG de semente fixa — mesmo dado, mesmo número na tela (sem "pular" a cada recarga). Validado contra a fórmula exata de P(B>A) para Beta.
- Frequentista ao lado (z-test de proporções e Welch para médias) para quem pede p-valor; SRM por qui-quadrado (p < 0,01 = alerta de divisão de tráfego quebrada); tamanho de amostra pela aproximação normal (α 5%, poder 80%).
- Veredito da UI: vencedora ≥ 95% de chance de bater o controle (com mínimo de visitantes), perdedora ≤ 5%, "liderando" ≥ 75%. Sem dependências: o mesmo código roda na API e no editor (`@abtest/shared/stats`).

## D-043 — Relatório do experimento (fase 9.4)
- Visitante do relatório = quem recebeu `exposure` (contado uma vez, na primeira variação vista). Conversão = visitante único que converteu a meta DEPOIS de exposto; receita = soma dos valores (conversões repetidas somam receita, não visitantes). Eventos de QA ficam fora.
- Meta primária = primeira meta da lista (sem coluna nova): "Tornar primária" nas Configurações move a meta para o topo. Ela decide a manchete, a série acumulada e a estimativa de duração.
- Filtro de dispositivo: as exposições não carregam dispositivo; usa-se o dispositivo predominante das páginas vistas de cada visitante exposto (pageviews são coletados de todos, D-041).
- Duração estimada: amostra para detectar +10% sobre a taxa atual do controle ÷ ritmo médio diário de visitantes.
- `pnpm seed:data` gera tráfego realista para a conta demo (dev) pelo próprio `/collect` — os módulos de insights vão estender o gerador.

## D-044 — Cliques de frustração e movimento do mouse (fase 10.1)
- Rage click: 3+ cliques em 700 ms num raio de 30 px (um evento por rajada). Dead click: clique sem nenhuma reação em 1 s — um `MutationObserver` no documento conta mutações, e navegação/`hashchange`/foco também contam como reação. Cliques em campos e com texto selecionado ficam de fora (a reação deles não mexe no DOM). Heurística parecida com a de Hotjar/Contentsquare; não exige saber se o elemento "deveria" ser clicável.
- Movimento: x relativo à largura da janela + y em px do documento (layouts responsivos de largura cheia ficam alinhados); um ponto a cada 150 ms, lotes de 50.
- Overlay com modos: calor (normalizado pela maior densidade, para não saturar), mapa de cliques (contagem e % por elemento), scrollmap (trechos pintados pela % que chegou), movimento e frustração. Todos amostrados pela taxa de insights da conta.
- Snippet subiu para 8,3 KB gzip. Próximas capturas pesadas (formulários, gravação) vão para um bundle sob demanda.

## D-045 — Mapas de calor como módulo (fase 10.2)
- Insights → Mapas de calor lista as páginas com dados (vistas, visitantes, cliques, rage/dead, scroll médio) e abre um visualizador em tela cheia: o mesmo iframe + agent do editor, em modo "navegar", sem aplicar variação — navegar no site troca a página analisada; a largura do dispositivo filtra os dados daquele dispositivo.
- Sessão de edição (`POST /edit-sessions`) passou a valer para qualquer papel: o viewer precisa dela para ver o mapa sobre o site real. O token só carrega o agent; salvar/publicar continuam exigindo editor.
- A lista guarda a URL real mais recente de cada página (`href`, com a barra final que o servidor espera) além da página normalizada.
