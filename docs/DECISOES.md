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
