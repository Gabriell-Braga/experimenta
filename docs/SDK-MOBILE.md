# SDK para apps (React Native, Android, iOS)

Três caminhos, todos decidindo **igual** ao site e aos SDKs server-side (mesmo MurmurHash3, mesmas regras):

| plataforma | o que usar | situação |
|---|---|---|
| React Native (iOS e Android) | `@abtest/react-native` (packages/react-native) | pronto, testado (Vitest, sem runtime RN) |
| Android nativo (Kotlin/Java) | SDK Java da 19.2 (`sdks/java`) | funciona no Android com as ressalvas da seção "Android" |
| iOS nativo (Swift) | ainda não há SDK | protocolo abaixo + `sdks/test-vectors.json` como especificação executável |

Mapas de calor e gravação de tela em app ficam para depois (PLANO 19.3).

## React Native

```bash
# no app (o pacote ainda não está publicado no npm: copie packages/react-native/dist ou use o monorepo)
npm i @react-native-async-storage/async-storage   # opcional, mas sem ele nada sobrevive ao fechar o app
```

Requisitos: React 18+, React Native 0.74+ (Hermes com `TextEncoder`, usado no hash; em versões antigas,
instale um polyfill de `TextEncoder`).

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { ExperimentaProvider, createClient, useFlag, useTrack, useVariation } from '@abtest/react-native';

// Uma vez, fora dos componentes.
const abt = createClient({
  accountId: '<conta>',
  cdnUrl: 'https://<api>/cdn',
  storage: AsyncStorage,
  appId: 'com.loja',          // URLs das telas: app://com.loja/<Tela>
  appVersion: '1.4.0',        // ex.: de expo-application / react-native-device-info
});
const nav = createNavigationContainerRef();

export const App = () => (
  <ExperimentaProvider client={abt}>
    <NavigationContainer ref={nav} onStateChange={() => abt.screen(nav.getCurrentRoute()?.name ?? '')}>
      <Rotas />
    </NavigationContainer>
  </ExperimentaProvider>
);

function Checkout({ usuario }) {
  const { enabled, variables, ready } = useFlag('novo-checkout', { plano: usuario.plano });
  const v = useVariation('checkout-rapido'); // { key, variables } | null (fora do teste ou carregando)
  const track = useTrack();
  return <Button title="Comprar" onPress={() => track('compra', { value: 199.9 })} />;
}
```

API do cliente (também acessível por `useExperimenta()`):

| | |
|---|---|
| `isEnabled(flag, attrs?)`, `getVariables(flag, attrs?)` | flag para este aparelho |
| `getVariation(campanha)` | variação da campanha server-side; registra a exposição (1 vez por abertura) |
| `track(evento, { value?, props? })` | evento; vira conversão nas campanhas com meta customizada de mesmo nome |
| `screen(nome)` | tela vista (ver "Telas") |
| `identify(userId?, attrs?)` | liga ao usuário no CDP e grava atributos (também valem nas regras das flags) |
| `flush()`, `close()` | envia a fila / para timers e envia |
| `ready`, `isReady`, `visitorId`, `version` | estado |

Hooks: `useFlag`, `useVariation` (= `useExperiment`), `useTrack`, `useScreen(nome)` (registra ao montar),
`useExperimenta`. Antes de ficar pronto (storage lido + config do cache ou da rede), flags dão `false` e
campanhas `null`; os hooks re-renderizam sozinhos quando fica pronto, quando a config muda e no `identify`.

Comportamento:

- **Visitante**: id anônimo gerado na 1ª abertura e guardado no storage. `visitorId` nas opções troca o id do
  sorteio (ex.: o id do usuário logado, para o app decidir igual ao backend e entre aparelhos). `identify` não
  muda o sorteio, só liga o perfil no CDP.
- **Atribuição persistida**: a 1ª variação sorteada fica guardada (como o cookie do site): mudar os pesos depois
  não troca a variação de quem já viu.
- **Config**: `<conta>.sdk.json`, guardado no storage. Com cache, o app decide já na abertura e atualiza em
  segundo plano; sem cache (1ª abertura), espera a rede. Recarrega a cada `refreshMs` (5 min) e ao voltar do
  background depois desse tempo.
- **Fila offline**: eventos vão para o storage, saem em lotes (`batchSize` 50) a cada `flushMs` (10 s) e ao ir
  para o background (AppState). Sem rede, 5xx ou 429: ficam para depois; outro 4xx (lote inválido): descartados.
  Teto `maxQueue` (1000), descartando os mais antigos. Reenvio pode duplicar: o /collect deduplica por `eventId`.
- **Sessão**: nova ao voltar do background depois de 30 min.
- **Aparelho**: `platform` (`ios`/`android`), `osVersion`, `deviceType` (`mobile`/`tablet`: menor lado ≥ 600 dp
  ou iPad) e `appVersion` entram nas regras das flags e vão para o perfil (um `identify` por abertura), para
  audiências e segmentos do CDP.
- Storage plugável: qualquer objeto com `getItem`/`setItem` assíncronos (AsyncStorage, MMKV embrulhado...).
  Sem storage, `memoryStorage()` (nada sobrevive ao fechar o app).

## Telas (formato no /collect)

Tela vista = evento `pageview` normal, sem campo novo:

```json
{ "type": "pageview", "url": "app://com.loja/Carrinho", "title": "Carrinho", "device": "mobile", "vw": 390, "...": "campos comuns" }
```

Os eventos seguintes levam a `url` da última tela. Assim telas entram em funis (passo por URL: `contains`
`/Carrinho` ou exato `app://com.loja/Carrinho`), jornadas, páginas e perfis sem mudança na API (a API só passou a
normalizar `app://...` como origin + caminho). Use nomes de rota sem espaços.

## Protocolo (para escrever um SDK nativo)

A referência é o SDK TS (`packages/sdk/src/index.ts` + `packages/snippet/src/bucket.ts` +
`packages/shared/src/sdk-config.ts`); a **especificação executável** é `sdks/test-vectors.json`: um SDK novo
só está certo quando confere todos os vetores (hashes, ~2.900 decisões de campanha e flag, 85 regras e a sequência
de eventos esperados no /collect). Veja como Python/Go/Java/PHP fazem em `sdks/*/tests`.

1. **Config**: `GET <cdn>/<conta>.sdk.json` →
   `{ accountId, version, publishedAt, trackingUrl?, flags: Flag[], experiments: [{ id, key, traffic, variations: [{ id, key, weight, variables? }], goals, group? }] }`.
   Guarde em cache; em falha de rede mantenha a última config válida (sem nenhuma: flags `false`, campanhas `null`).
2. **Hash**: MurmurHash3 x86 32 bits, seed 0, sobre os **bytes UTF-8** da string (surrogate solto → U+FFFD), resultado
   sem sinal. `bucket(id, salt) = murmur3(id + salt) % 10000`.
3. **Flag**: `enabled` e todas as `rules` passam e `bucket(id, "flag:" + key) < round(rollout * 100)`
   (`round` = meio para cima, como `Math.round`). Regra: atributo ausente só passa em `neq`; o valor vira texto como
   `String(v)` do JS (`eq`, `neq`, `in` com valores separados por vírgula e espaços aparados, `contains`) ou número
   como `Number(v)` do JS (`gte`, `lte`). Detalhes de conversão: D-090.
4. **Campanha**: grupo exclusivo (`group`) → entra só se `bucket(id, group.id) % 100` estiver em `group.slots`;
   `b = bucket(id, exp.id)`; `included = round(traffic * 100)`; `b >= included` → fora; pesos:
   `point = b / included * soma(pesos)` em double, percorre as variações subtraindo os pesos até `point < weight`
   (soma 0 → fora). Num app, guarde a 1ª variação (id) e reuse enquanto ela existir e o visitante continuar na
   fatia do grupo.
5. **Eventos**: `POST trackingUrl`, `content-type: text/plain`, corpo `{"events": [...]}` (até 200 eventos e 64 KB
   por lote; resposta 204). Campos comuns: `eventId` (UUID), `ts` (ms), `accountId`, `visitorId`, `url`
   (`app://<appId>/<Tela>` no app; `sdk://server` no servidor), `sessionId?`. Tipos usados: `exposure`
   (+ `experimentId`, `experimentKey`, `variationId`, `variationKey`; uma vez por visitante e campanha por
   processo/abertura), `event` (`name`, `value?`, `props?`), `conversion` (campos da exposição + `goalId`,
   `goalKey`, `value?`, gerada para cada meta `custom` cujo `event` = nome do evento, nas campanhas em que o
   visitante está), `pageview` (tela, acima) e `identify` (`userId?`, `attrs?`). Esquema completo:
   `TrackingEventSchema` (packages/shared/src/events.ts) e docs/EVENTOS.md. Eventos inválidos são descartados em
   silêncio pelo /collect.

## Android nativo (SDK Java)

O SDK Java (`sdks/java`) roda no Android, sem dependências:

- **HTTP**: o Android não tem `java.net.http`; sem `transport` nas opções o cliente cai para `HttpURLConnection`
  (`Client.urlConnectionTransport`, testado contra um servidor HTTP local no CI). A troca automática não foi
  testada num Android real: para garantir, passe `.transport(Client.urlConnectionTransport(10_000))`. Com R8/minify, adicione ao `proguard-rules.pro`:
  `-dontwarn java.net.http.**`. Precisa de `<uses-permission android:name="android.permission.INTERNET" />`.
- **API mínima**: o caminho padrão não usa `java.time` (só `Options.timeout(Duration)` usa; prefira
  `timeoutMs`). Compilado para Java 11: AGP 7+ (D8 converte).
- **Threads**: `Client.create` baixa a config **na hora** (bloqueia) e falha no main thread
  (`NetworkOnMainThreadException`, o cliente fica sem config até o próximo refresh). Crie em background
  (`Dispatchers.IO`/`Executor`) ou passe a config em cache com `Options.config(json)`. As decisões são locais e
  seguras no main thread; envio e refresh rodam numa thread daemon do SDK.
- **Lifecycle**: envie a fila quando o app vai para o background:

```kotlin
class App : Application() {
  lateinit var abt: Client
  override fun onCreate() {
    super.onCreate()
    Executors.newSingleThreadExecutor().execute {
      abt = Client.create(Client.Options("<conta>", "https://<api>/cdn").refreshMs(300_000).flushMs(10_000))
    }
    ProcessLifecycleOwner.get().lifecycle.addObserver(LifecycleEventObserver { _, e ->
      if (e == Lifecycle.Event.ON_STOP && ::abt.isInitialized) Executors.newSingleThreadExecutor().execute { abt.flush() }
    })
  }
}
// em qualquer tela: abt.getVariation("checkout-rapido", visitorId)?.key
```

- **O que fica com o app** (o SDK Java é do servidor): o id do visitante (gere um UUID e guarde em
  `SharedPreferences`), a persistência da variação (a decisão é determinística pelo id; só muda para quem já viu
  se os pesos mudarem), a fila offline (eventos não enviados se perdem quando o processo morre) e o evento de
  tela (`pageview`, não exposto pelo SDK Java). Se precisar disso no Android nativo, o caminho é um SDK Kotlin
  próprio seguindo o protocolo acima e os vetores.

## iOS nativo

Sem SDK Swift por enquanto (D-091): não há como compilar nem testar Swift aqui, e um SDK não testado contra os
vetores é pior que nenhum. Para escrever: siga o protocolo acima, carregue `sdks/test-vectors.json` num
`XCTest` e confira tudo; cuidado com `UInt32` (`&*`, `&+` para multiplicação/soma com estouro), `utf8` da
`String` (Swift já troca surrogate solto por U+FFFD) e o `Math.round` do JS (`(x + 0.5).rounded(.down)`).
Persistência: `UserDefaults` para id do visitante, atribuições e fila; envio ao ir para o background
(`UIApplication.didEnterBackgroundNotification`).
