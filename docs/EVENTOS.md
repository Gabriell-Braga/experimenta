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
| `type` | string | `exposure`, `conversion`, `selector_failed`, `selector_healed` |
| `eventId` | string | UUID do evento (deduplicação) |
| `ts` | number | epoch em ms, relógio do navegador |
| `accountId` | string | conta (tenant) |
| `visitorId` | string | ID do visitante (cookie first-party `_abt_vid`, 1 ano; fallback localStorage) |
| `url` | string | `location.href` no momento do evento |
| `experimentId` / `experimentKey` | string | experimento (id interno / chave legível) |
| `variationId` / `variationKey` | string | variação atribuída (a primeira variação do experimento é o controle) |
| `qa` | boolean? | `true` quando a variação foi forçada por `?ab_force` — **descartar nas estatísticas** |

## Tipos

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

## Integrações no navegador

- `window.addEventListener('abt:event', e => e.detail)` — todo evento, um a um.
- `window.abq.push(['adapter', (events) => { ... }])` — adaptador plugável que recebe os lotes.
- `window.abt.assignments()` — `{ chaveExperimento: chaveVariacao }` do visitante; `window.abt.visitorId`;
  `window.abt.flush()` força o envio.

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
