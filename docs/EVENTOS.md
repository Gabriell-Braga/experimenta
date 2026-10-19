# Eventos do snippet

Contrato entre o snippet (runtime no site do cliente) e o módulo de analytics.
Fonte da verdade do schema: `packages/shared/src/events.ts` (`TrackingEventSchema`, zod).

## Transporte

- O snippet acumula eventos e envia em **lote** por `navigator.sendBeacon(trackingUrl, body)`
  (fallback: `fetch` com `keepalive`). O lote sai a cada 1 s, imediatamente quando há uma **conversão**,
  e ao esconder/sair da página (`visibilitychange` → hidden, `pagehide`).
- `trackingUrl` vem da configuração publicada (`PublishedConfig.trackingUrl`). Sem ela, nenhum envio HTTP é feito
  (os adaptadores plugados e o `CustomEvent` continuam funcionando).
- Corpo: `Content-Type: text/plain` (evita preflight CORS; sendBeacon não faz preflight) com JSON:

```json
{ "events": [ { "type": "exposure", "...": "..." } ] }
```

- O endpoint deve responder 2xx rápido, aceitar `text/plain`, permitir CORS do domínio do cliente e
  **deduplicar por `eventId`** (reenvios são possíveis).

## Campos comuns (todos os eventos)

| campo | tipo | descrição |
|---|---|---|
| `type` | string | `pageview`, `event`, `identify`, `exposure`, `conversion`, `selector_failed`, `selector_healed`, `click`, `scroll` |
| `eventId` | string | UUID do evento (deduplicação) |
| `ts` | number | epoch em ms, relógio do navegador |
| `accountId` | string | conta (tenant) |
| `visitorId` | string | ID do visitante (cookie first-party `_abt_vid`, 1 ano; fallback localStorage) |
| `sessionId` | string? | sessão (cookie `_abt_sid`, expira após 30 min sem página nova) |
| `url` | string | `location.href` no momento do evento |
| `experimentId` / `experimentKey` | string | experimento (id interno / chave legível) — **não** existe em `click`/`scroll` |
| `variationId` / `variationKey` | string | variação atribuída (a primeira variação do experimento é o controle) — **não** existe em `click`/`scroll` |
| `qa` | boolean? | `true` quando a variação foi forçada por `?ab_force` — **descartar nas estatísticas** |

## Tipos

### `pageview`
Página vista: no carregamento e a cada rota de SPA. Enviado para **todos** os visitantes (não é amostrado) — base
de funis, jornadas, coortes e perfis. Campos: `device`, `title?`, `referrer?` (na SPA, a página anterior), `vw`
(largura da janela).

### `event`
Evento customizado: `abq.push(['track', nome, valor?, props?])` ou `abq.push(['event', nome, props?])`
(`props.value` numérico vira o valor). Campos: `name`, `value?` (receita), `props?` (escalares). Também dispara
as metas do tipo "evento customizado" com o mesmo nome.

### `identify`
`abq.push(['identify', userId, atributos?])` liga o visitante ao usuário do site; `abq.push(['set', atributos])`
só grava atributos. Campos: `userId?`, `attrs?`. O snippet guarda um perfil local (`localStorage._abt_p`: páginas
vistas, sessões, contagem de eventos, usuário e atributos) para a segmentação comportamental.

### `exposure`
O visitante viu a variação: emitido quando o experimento é **ativado** na página (primeira carga que casa com a
segmentação, ou reentrada numa rota segmentada de SPA). Variações de controle também emitem exposure.
Em variações de redirect (URL dividida), é emitido na página de origem, antes do redirecionamento.

### `conversion`
| campo | tipo | descrição |
|---|---|---|
| `goalId` / `goalKey` | string | meta atingida |
| `value` | number? | valor (só metas custom: `abq.push(['track', 'evento', valor])`) |

Emitido para **todos** os experimentos em que o visitante está atribuído e que têm a meta — mesmo que o experimento
não esteja ativo na página atual (ex.: conversão em `/obrigado`). Não há deduplicação no snippet: cada clique/envio/
visita gera um evento; a política (primeira conversão, todas, soma de valores) fica com o analytics.

Tipos de meta: `click` (clique em elemento que casa com o seletor, inclusive filhos), `pageview` (URL casa com a regra;
avaliado no load e a cada navegação de SPA), `formSubmit` (envio de formulário que casa com o seletor),
`custom` (`window.abq.push(['track', 'nome-do-evento', valorOpcional])`).

### `selector_failed`
| campo | tipo | descrição |
|---|---|---|
| `operationId` | string | operação cujo alvo não foi encontrado |
| `selector` | string | seletor principal da operação |

Emitido quando o timeout de espera (padrão 1500 ms após DOMContentLoaded) expira sem achar o elemento por nenhum
meio (principal, alternativos, impressão digital). O visitante vê o original nesse elemento.

### `selector_healed`
| campo | tipo | descrição |
|---|---|---|
| `operationId` | string | operação |
| `selector` | string | seletor principal (que falhou) |
| `healedSelector` | string | seletor que achou o elemento (alternativo, ou caminho nth-of-type do elemento achado por impressão digital) |
| `via` | `alternate` \| `fingerprint` | como foi curado |

A alteração foi aplicada, mas o seletor principal quebrou — sinal para revisar o experimento no editor.

### `click` (mapa de calor / cliques)
Só para visitantes amostrados (`PublishedConfig.heatmap.sampleRate`, decisão determinística por visitante) e nunca em modo QA.

| campo | tipo | descrição |
|---|---|---|
| `selector` | string | caminho curto do elemento clicado (nth-of-type ancorado no id mais próximo), até 500 caracteres |
| `rx` / `ry` | number 0..1 | posição do clique DENTRO do elemento (0,0 = canto superior esquerdo) |
| `px` / `py` | number | coordenadas do clique na página (px) |
| `vw` / `vh` | number | tamanho da viewport |
| `device` | `desktop` \| `tablet` \| `mobile` | dispositivo detectado |
| `variations` | objeto | experimentos ATIVOS na página → variação (`{ "<experimentId>": "<variationId>" }`) |

### `frustration` (rage / dead click)
Amostrado como o mapa de calor. `kind: 'rage'` = 3+ cliques em até 700 ms num raio de 30 px (um evento por rajada);
`kind: 'dead'` = clique sem reação da página em 1 s (nenhuma mutação do DOM, navegação, `hashchange` ou foco;
cliques em campos de formulário e seleção de texto não contam). Campos: `selector`, `rx`, `ry`, `count`, `device`, `variations`.

### `move` (movimento do mouse)
Amostrado. Um ponto a cada 150 ms em movimento, em lotes de até 50 (e ao sair/navegar). `points: [x, y][]` com
x relativo à largura da janela (0..1) e y em px do documento; `vw`, `device`, `variations`.

### `scroll`
Um por página vista: no `pagehide` e a cada navegação de SPA (com a URL da página que ficou para trás).

| campo | tipo | descrição |
|---|---|---|
| `depth` | number 0..100 | profundidade máxima vista (% da altura da página, contando a viewport) |
| `vh` / `ph` | number | altura da viewport / da página no momento |
| `device`, `variations` | | como em `click` |

### Agregação (nossa API)
`GET /analytics/overview?days=30` — totais (visitantes, sessões, páginas, eventos, conversões, receita), série
diária, páginas e eventos mais frequentes, dispositivos e origens externas. `GET /events?type=&visitorId=&sessionId=&limit=`
— eventos crus mais recentes.

`GET /heatmap?url=<página>&experimentId=&variationId=&device=` (autenticado) agrupa por página (origin + caminho, sem query/hash/barra final): cliques por seletor (contagem + até 200 pontos `[rx, ry]` mais recentes) e alcance de scroll (`reached`: % das páginas vistas que chegaram a 10, 20, … 100%). É o que o overlay do editor desenha; o analytics pode consumir os eventos crus.

## Integrações no navegador

- `window.addEventListener('abt:event', e => e.detail)` — todo evento, um a um.
- `window.abq.push(['adapter', (events) => { ... }])` — adaptador plugável que recebe os lotes.
- `window.abt.assignments()` — `{ chaveExperimento: chaveVariacao }` do visitante; `window.abt.visitorId`;
  `window.abt.sessionId`; `window.abt.flush()` força o envio.

## Exemplo

```json
{
  "events": [
    {
      "type": "exposure",
      "eventId": "0b6c8a8e-1f3e-4a53-9a71-4f1d1b0c2a10",
      "ts": 1760412345678,
      "accountId": "demo",
      "visitorId": "5f1c2a9e-0d2b-4c3a-8f7e-6b5a4d3c2b1a",
      "url": "https://loja.com/",
      "experimentId": "e1",
      "experimentKey": "hero",
      "variationId": "v1",
      "variationKey": "b"
    },
    {
      "type": "conversion",
      "goalId": "g3",
      "goalKey": "signup",
      "value": 7,
      "eventId": "...", "ts": 1760412349999, "accountId": "demo", "visitorId": "...", "url": "https://loja.com/",
      "experimentId": "e1", "experimentKey": "hero", "variationId": "v1", "variationKey": "b"
    }
  ]
}
```

## Gravação de sessão (`POST /rec`)
Fora do `/collect`: o `insights.js` (carregado sob demanda pelo snippet só para visitantes amostrados, nunca em
QA/edição) grava com rrweb e envia blocos `text/plain` a cada 5 s, ao acumular ~200 KB, no snapshot completo e
ao sair da página (`keepalive` quando cabe). Corpo: `{ accountId, sessionId, visitorId, device, vw, vh, events }`
(`events` = eventos do rrweb, até 5000 por bloco; corpo até 1 MB). Campos de formulário sempre mascarados;
`.abt-block` some da gravação e `.abt-mask` tem o texto mascarado. `GET /recordings` lista as sessões (com
cliques/frustração/conversões cruzados pelos eventos da mesma sessão) e `GET /recordings/{sessionId}` devolve os
eventos rrweb + linha do tempo.

### `form` (form analytics)
Enviado pelo `insights.js` (amostrado) uma vez por formulário por página vista: no `submit` ou ao sair/navegar.
`form` (seletor: `#id`, `form[name=…]` ou caminho), `interacted`, `submitted`, `lastField?` (último campo com
foco de quem saiu sem enviar) e `fields[]` com `name`, `kind`, `time` (ms com foco), `hesitation?` (foco → primeira
digitação), `focus`, `refills` (editou de novo depois de sair preenchido) e `filled`. **Nenhum valor digitado é
enviado.** `GET /analytics/forms?days=&device=` agrega por página + formulário.

### `engage` (pop-ups e pesquisas)
Enviado pelo `engage.js` (carregado sob demanda quando há campanha publicada; nunca em QA/edição).
`campaignId`, `kind` (`popup` | `survey`), `action` (`view`, `click` no CTA, `close`, `submit`).
`GET /analytics/engage?days=` agrega por campanha (exibições, visitantes, cliques/CTR, fechamentos, respostas).

### `survey` (respostas de pesquisa)
`surveyId`, `answers[]` (`questionId`, `value`: número, texto ou lista de opções) e `completed` (false = fechou no
meio; vale a última resposta de cada visitante). `GET /analytics/survey/{id}` calcula NPS, CSAT, CES, médias,
distribuições, escolhas e palavras frequentes nas respostas abertas.

## E-commerce (recomendações)
- `abq.push(['product', { id, name, price, category, url, image }])` → evento `product_view` (props = produto) e o id
  entra no perfil local (`_abt_p.r`, últimos 20).
- `abq.push(['cart', id])` → `add_to_cart`; `abq.push(['purchase', [id1, id2], total])` → `purchase` (valor = total,
  `props.ids` = ids separados por vírgula; conta como receita em metas `purchase`).
- Modelo pré-calculado em `/cdn/<conta>.reco.json` (de hora em hora, ao publicar e em `POST /recommendations/rebuild`);
  API pública `GET /reco/{conta}/{coview|copurchase|upsell|nbo|trending|bestsellers}?product=&viewed=&limit=`.
