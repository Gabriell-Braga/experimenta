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
