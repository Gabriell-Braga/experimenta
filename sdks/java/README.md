# Experimenta — SDK Java/Kotlin

Feature flags e campanhas server-side decididas localmente, com o mesmo bucketing do snippet e do SDK JS.
Java 11+, sem dependências (HTTP do `java.net.http`, JSON próprio). No Kotlin, use o mesmo SDK. No Android também
(`HttpURLConnection` no lugar do `java.net.http`): threads, lifecycle e R8 em [docs/SDK-MOBILE.md](../../docs/SDK-MOBILE.md).

## Instalação

```bash
mvn -B -DskipTests install   # nesta pasta; depois, no seu pom:
```

```xml
<dependency>
  <groupId>com.experimenta</groupId>
  <artifactId>experimenta-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Uso (Java)

```java
import com.experimenta.sdk.Client;
import com.experimenta.sdk.Decision;

Client abt = Client.create(new Client.Options("<conta>", "https://<api>/cdn"));

Map<String, Object> attrs = Map.of("plano", usuario.getPlano());
if (abt.isEnabled("novo-checkout", usuario.getId(), attrs)) {
  Object passos = abt.getVariables("novo-checkout", usuario.getId(), attrs).get("passos");
}
Decision v = abt.getVariation("checkout-rapido", usuario.getId()); // null = fora do teste
abt.track("compra", usuario.getId(), 199.9, null);
abt.close(); // no encerramento: envia o que falta
```

## Uso (Kotlin)

```kotlin
val abt = Client.create(Client.Options("<conta>", "https://<api>/cdn"))

if (abt.isEnabled("novo-checkout", usuario.id, mapOf("plano" to usuario.plano))) { /* ... */ }
val v = abt.getVariation("checkout-rapido", usuario.id)   // v?.key, v?.variables
abt.track("compra", usuario.id, 199.9, null)
```

Opções (`Client.Options`): `refreshMs` (0 = nunca recarrega; padrão 60 s), `flushMs` (0 = só em
`flush()`/`close()`; padrão 2 s), `config`, `transport` (ex.: `Client.urlConnectionTransport(ms)`), `timeoutMs`
(ou `timeout(Duration)`). Seguro entre threads.

## Testes

```bash
mvn -B -DskipTests package
java -cp target/classes:target/test-classes com.experimenta.sdk.VectorsTest   # confere ../test-vectors.json
```
