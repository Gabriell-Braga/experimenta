package com.experimenta.sdk;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Compatibilidade com o SDK JS/TS: confere decisão por decisão contra sdks/test-vectors.json. Sem framework de
 * teste (zero dependências): {@code java -cp target/classes:target/test-classes com.experimenta.sdk.VectorsTest}.
 */
@SuppressWarnings("unchecked")
public final class VectorsTest {
  private static int failures;
  private static int checks;

  private static void check(boolean ok, String msg) {
    checks++;
    if (!ok && failures++ < 50) System.err.println("FALHOU: " + msg);
  }

  private static Map<String, Object> m(Object o) {
    return (Map<String, Object>) o;
  }

  private static List<Object> l(Object o) {
    return (List<Object>) o;
  }

  public static void main(String[] args) throws Exception {
    String path = System.getProperty("vectors", "../test-vectors.json");
    Map<String, Object> v = m(Json.parse(new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8)));
    Map<String, Object> config = m(v.get("config"));
    List<Object> users = l(v.get("users"));

    // murmur3
    for (Object o : l(v.get("murmur3"))) {
      Map<String, Object> c = m(o);
      long got = Bucketing.murmurhash3((String) c.get("input"));
      check(got == ((Number) c.get("hash")).longValue(), "murmur3(" + c.get("input") + ") = " + got);
    }

    Client client = Client.create(new Client.Options("acc-vetores", "").config(config).refreshMs(0).flushMs(0)
        .transport((method, url, body) -> ""));

    // experimentos
    for (Object o : l(v.get("experiments"))) {
      Map<String, Object> e = m(o);
      List<Object> expected = l(e.get("variations"));
      for (int i = 0; i < users.size(); i++) {
        Decision d = client.getVariation((String) e.get("key"), (String) users.get(i));
        String got = d == null ? null : d.key;
        check(Objects.equals(got, expected.get(i)), e.get("key") + " / " + users.get(i) + ": " + got);
      }
    }

    // flags
    Map<String, Map<String, Object>> flags = new LinkedHashMap<>();
    for (Object f : l(config.get("flags"))) flags.put((String) m(f).get("key"), m(f));
    for (Object o : l(v.get("flags"))) {
      Map<String, Object> f = m(o);
      String key = (String) f.get("key");
      Map<String, Object> attrs = m(f.get("attributes"));
      List<Object> enabled = l(f.get("enabled"));
      for (int i = 0; i < users.size(); i++) {
        String u = (String) users.get(i);
        boolean want = (Boolean) enabled.get(i);
        check(client.isEnabled(key, u, attrs) == want, key + " / " + u + " / " + attrs);
        Object vars = flags.get(key).get("variables");
        Object wantVars = want && vars != null ? vars : Collections.emptyMap();
        check(client.getVariables(key, u, attrs).equals(wantVars), "variáveis " + key + " / " + u);
      }
    }
    check(!client.isEnabled("nao-existe", "u1"), "flag inexistente");

    // regras
    for (Object o : l(v.get("rules"))) {
      Map<String, Object> r = m(o);
      boolean got = Rules.flagRuleMatches(m(r.get("rule")), m(r.get("attributes")));
      check(got == (Boolean) r.get("match"), "regra " + r.get("rule") + " com " + r.get("attributes"));
    }

    // sequência de exposições/eventos e o formato enviado ao /collect
    List<Object> posted = new ArrayList<>();
    Client tracker = Client.create(new Client.Options("acc-vetores", "").config(config).refreshMs(0).flushMs(0)
        .transport((method, url, body) -> {
          check("POST".equals(method) && url.equals(config.get("trackingUrl")), "POST " + url);
          posted.addAll(l(m(Json.parse(body)).get("events")));
          return "";
        }));
    Map<String, Object> track = m(v.get("track"));
    for (Object o : l(track.get("calls"))) {
      Map<String, Object> c = m(o);
      String user = (String) c.get("userId");
      if ("track".equals(c.get("call"))) {
        Object value = c.get("value");
        tracker.track((String) c.get("event"), user, value == null ? null : ((Number) value).doubleValue(),
            (Map<String, ?>) c.get("props"));
        continue;
      }
      Decision d = tracker.getVariation((String) c.get("experiment"), user);
      Map<String, Object> got = null;
      if (d != null) {
        got = new LinkedHashMap<>();
        got.put("key", d.key);
        got.put("variables", d.variables);
      }
      check(Objects.equals(got, c.get("result")), "getVariation " + c.get("experiment") + " / " + user + ": " + got);
    }
    tracker.close();
    for (Object o : posted) {
      Map<String, Object> e = m(o);
      check(e.remove("eventId") instanceof String, "eventId");
      check(e.remove("ts") instanceof Long, "ts");
    }
    check(posted.equals(track.get("events")), "eventos:\n" + Json.stringify(posted) + "\nesperado:\n"
        + Json.stringify(track.get("events")));

    clientTests(config);

    System.out.println(checks + " verificações, " + failures + " falhas");
    if (failures > 0) System.exit(1);
  }

  private static void clientTests(Map<String, Object> config) throws Exception {
    // baixa a config da CDN e mantém a última válida quando a rede cai
    List<String> urls = new ArrayList<>();
    String body = Json.stringify(config);
    Client c = Client.create(new Client.Options("acc-vetores", "https://cdn.test/").refreshMs(0).flushMs(0)
        .transport((method, url, b) -> {
          urls.add(url);
          if (urls.size() > 1) throw new java.io.IOException("rede caiu");
          return body;
        }));
    check(urls.equals(Collections.singletonList("https://cdn.test/acc-vetores.sdk.json")), "url da config " + urls);
    check(c.version() == 7, "versão " + c.version());

    // sem config: tudo desligado, sem erro
    Client off = Client.create(new Client.Options("x", "https://cdn.test").refreshMs(0).flushMs(0)
        .transport((method, url, b) -> null));
    check(!off.isEnabled("rollout-100", "u1") && off.getVariation("meio-a-meio", "u1") == null, "sem config");
    off.track("compra", "u1");
    off.close();

    // falha no envio devolve para a fila; o timer envia sozinho
    AtomicBoolean fail = new AtomicBoolean(true);
    List<String> sent = new ArrayList<>();
    CountDownLatch timerSent = new CountDownLatch(1);
    Client.Transport t = (method, url, b) -> {
      if (fail.get()) throw new java.io.IOException("timeout");
      synchronized (sent) {
        for (Object e : l(m(Json.parse(b)).get("events"))) {
          if ("event".equals(m(e).get("type"))) sent.add((String) m(e).get("visitorId"));
        }
      }
      timerSent.countDown();
      return "";
    };
    Client q = Client.create(new Client.Options("acc-vetores", "").config(config).refreshMs(0).flushMs(0).transport(t));
    q.track("compra", "u1");
    q.flush();
    fail.set(false);
    q.track("compra", "u2");
    q.flush();
    check(sent.equals(java.util.Arrays.asList("u1", "u2")), "reenvio " + sent);

    CountDownLatch[] latch = {new CountDownLatch(1)};
    Client timed = Client.create(new Client.Options("acc-vetores", "").config(config).refreshMs(0).flushMs(20)
        .transport((method, url, b) -> {
          latch[0].countDown();
          return "";
        }));
    timed.track("compra", "u3");
    check(latch[0].await(2, TimeUnit.SECONDS), "timer não enviou");
    timed.close();
    check(timerSent.getCount() == 0, "envio manual");

    urlConnectionTests(body);
  }

  /** Transporte do Android (HttpURLConnection) contra um servidor HTTP local de verdade. */
  private static void urlConnectionTests(String sdkJson) throws Exception {
    com.sun.net.httpserver.HttpServer server =
        com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    List<String> posted = Collections.synchronizedList(new ArrayList<>());
    server.createContext("/cdn/acc-vetores.sdk.json", ex -> {
      byte[] b = sdkJson.getBytes(StandardCharsets.UTF_8);
      ex.sendResponseHeaders(200, b.length);
      ex.getResponseBody().write(b);
      ex.close();
    });
    server.createContext("/collect", ex -> {
      posted.add(ex.getRequestMethod() + " " + ex.getRequestHeaders().getFirst("content-type") + " "
          + new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      ex.sendResponseHeaders(204, -1);
      ex.close();
    });
    server.createContext("/falha", ex -> {
      ex.sendResponseHeaders(500, -1);
      ex.close();
    });
    server.start();
    try {
      String base = "http://127.0.0.1:" + server.getAddress().getPort();
      Client.Transport t = Client.urlConnectionTransport(5_000);
      Client c = Client.create(new Client.Options("acc-vetores", base + "/cdn").refreshMs(0).flushMs(0).transport(t));
      check(c.version() == 7, "urlConnection: versão " + c.version());
      check(t.send("GET", base + "/falha", null) == null, "urlConnection: 5xx = null");
      check(t.send("POST", base + "/collect", "{\"events\":[\"ç\"]}") != null, "urlConnection: 204 = corpo");
      check(posted.size() == 1 && posted.get(0).equals("POST text/plain {\"events\":[\"ç\"]}"),
          "urlConnection: POST " + posted);
      boolean threw = false;
      try {
        Client.urlConnectionTransport(1_000).send("GET", "http://127.0.0.1:1/nada", null);
      } catch (java.io.IOException e) {
        threw = true;
      }
      check(threw, "urlConnection: rede fora lança exceção");
      c.close();
    } finally {
      server.stop(0);
    }
  }
}
