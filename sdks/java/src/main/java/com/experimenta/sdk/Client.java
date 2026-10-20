package com.experimenta.sdk;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * SDK server-side do Experimenta (Java 11+, só stdlib; usável direto do Kotlin).
 *
 * <p>Mesma API e semântica do SDK JS/TS (packages/sdk): baixa {@code <conta>.sdk.json} da CDN, guarda em memória e
 * recarrega em segundo plano; decide flags e campanhas localmente com o mesmo bucketing do snippet; junta
 * exposições/eventos/conversões e envia para o /collect. Seguro entre threads. Feche com {@link #close()}.
 */
public final class Client implements AutoCloseable {

  /** Transporte HTTP (injetável para testes/proxies). */
  @FunctionalInterface
  public interface Transport {
    /**
     * @return o corpo da resposta se 2xx, {@code null} se outro status
     * @throws Exception falha de rede (eventos voltam para a fila)
     */
    String send(String method, String url, String body) throws Exception;
  }

  /** Opções do cliente. */
  public static final class Options {
    final String accountId;
    final String cdnUrl;
    long refreshMs = 60_000;
    long flushMs = 2_000;
    Map<String, Object> config;
    Transport transport;
    Duration timeout = Duration.ofSeconds(10);

    /**
     * @param accountId id da conta
     * @param cdnUrl base da CDN (ex.: https://api.exemplo.com/cdn); o SDK baixa {@code <conta>.sdk.json}
     */
    public Options(String accountId, String cdnUrl) {
      this.accountId = accountId;
      this.cdnUrl = cdnUrl == null ? "" : cdnUrl;
    }

    /** Recarrega a config a cada N ms (0 = nunca). Padrão 60 s. */
    public Options refreshMs(long ms) {
      this.refreshMs = ms;
      return this;
    }

    /** Envia os eventos juntos a cada N ms (0 = só em flush/close). Padrão 2 s. */
    public Options flushMs(long ms) {
      this.flushMs = ms;
      return this;
    }

    /** Config já carregada (JSON do sdk.json): não baixa na criação. */
    public Options config(String sdkJson) {
      return config(Client.asMap(Json.parse(sdkJson)));
    }

    /** Config já carregada (resultado de {@link Json#parse}). */
    public Options config(Map<String, Object> config) {
      this.config = config;
      return this;
    }

    public Options transport(Transport transport) {
      this.transport = transport;
      return this;
    }

    /** Timeout das requisições do transporte padrão. Padrão 10 s. */
    public Options timeout(Duration timeout) {
      this.timeout = timeout;
      return this;
    }
  }

  private final String accountId;
  private final String configUrl;
  private final Transport transport;
  private volatile Map<String, Object> config;
  private final Object lock = new Object();
  private List<Map<String, Object>> queue = new ArrayList<>();
  private final Set<String> exposed = new HashSet<>();
  private final ScheduledExecutorService timers;

  private Client(Options o) {
    this.accountId = o.accountId;
    this.configUrl = o.cdnUrl.replaceAll("/+$", "") + "/" + o.accountId + ".sdk.json";
    this.transport = o.transport != null ? o.transport : httpTransport(o.timeout);
    this.config = o.config;
    if (config == null) load();
    timers =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "experimenta-sdk");
              t.setDaemon(true);
              return t;
            });
    if (o.refreshMs > 0) {
      timers.scheduleWithFixedDelay(this::load, o.refreshMs, o.refreshMs, TimeUnit.MILLISECONDS);
    }
    if (o.flushMs > 0) {
      timers.scheduleWithFixedDelay(this::flush, o.flushMs, o.flushMs, TimeUnit.MILLISECONDS);
    }
  }

  /**
   * Cria o cliente. Sem config nas opções, baixa a da CDN agora; falha de rede deixa o cliente sem config (tudo
   * desligado/null) até o próximo refresh, como no SDK JS.
   */
  public static Client create(Options options) {
    return new Client(options);
  }

  private static Transport httpTransport(Duration timeout) {
    HttpClient http = HttpClient.newBuilder().connectTimeout(timeout).build();
    return (method, url, body) -> {
      HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).timeout(timeout);
      if ("POST".equals(method)) {
        b.header("content-type", "text/plain").POST(HttpRequest.BodyPublishers.ofString(body));
      }
      HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
      return r.statusCode() >= 200 && r.statusCode() < 300 ? r.body() : null;
    };
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object v) {
    if (!(v instanceof Map)) throw new IllegalArgumentException("sdk.json deveria ser um objeto");
    return (Map<String, Object>) v;
  }

  private void load() {
    try {
      String body = transport.send("GET", configUrl, null);
      if (body != null) config = asMap(Json.parse(body));
    } catch (Exception e) { // rede ou JSON inválido: mantém a última config válida
    }
  }

  /** Versão publicada da config carregada (0 = nenhuma). */
  public int version() {
    Map<String, Object> c = config;
    return c != null && c.get("version") instanceof Number ? ((Number) c.get("version")).intValue() : 0;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> find(String list, String key) {
    Map<String, Object> c = config;
    if (c == null || !(c.get(list) instanceof List)) return null;
    for (Object x : (List<Object>) c.get(list)) {
      Map<String, Object> m = (Map<String, Object>) x;
      if (key.equals(m.get("key"))) return m;
    }
    return null;
  }

  /** Flag ativa para este usuário? (ligada + regras de atributo + dentro do rollout). */
  @SuppressWarnings("unchecked")
  public boolean isEnabled(String key, String userId, Map<String, ?> attrs) {
    Map<String, Object> flag = find("flags", key);
    if (flag == null || !Boolean.TRUE.equals(flag.get("enabled"))) return false;
    Object rules = flag.get("rules");
    if (rules instanceof List) {
      for (Object r : (List<Object>) rules) {
        if (!Rules.flagRuleMatches((Map<String, ?>) r, attrs)) return false;
      }
    }
    double rollout = Bucketing.num(flag.get("rollout"), 100);
    return Bucketing.bucketOf(userId, "flag:" + key)
        < Bucketing.jsRound(rollout * (Bucketing.BUCKETS / 100));
  }

  public boolean isEnabled(String key, String userId) {
    return isEnabled(key, userId, Collections.emptyMap());
  }

  /** Variáveis da flag (vazio quando inativa). */
  @SuppressWarnings("unchecked")
  public Map<String, Object> getVariables(String key, String userId, Map<String, ?> attrs) {
    if (!isEnabled(key, userId, attrs)) return new LinkedHashMap<>();
    Object vars = find("flags", key).get("variables");
    return vars instanceof Map ? new LinkedHashMap<>((Map<String, Object>) vars) : new LinkedHashMap<>();
  }

  public Map<String, Object> getVariables(String key, String userId) {
    return getVariables(key, userId, Collections.emptyMap());
  }

  /**
   * Variação da campanha server-side (registra a exposição na 1ª vez por usuário). null = campanha inexistente ou
   * usuário fora do tráfego/grupo.
   */
  @SuppressWarnings("unchecked")
  public Decision getVariation(String experimentKey, String userId) {
    Map<String, Object> exp = find("experiments", experimentKey);
    if (exp == null) return null;
    Map<String, Object> v = Bucketing.chooseVariation(userId, exp);
    if (v == null) return null;
    synchronized (lock) {
      if (exposed.add(exp.get("id") + "|" + userId)) {
        Map<String, Object> e = base(userId);
        e.put("type", "exposure");
        e.put("experimentId", exp.get("id"));
        e.put("experimentKey", exp.get("key"));
        e.put("variationId", v.get("id"));
        e.put("variationKey", v.get("key"));
        queue.add(e);
      }
    }
    Object vars = v.get("variables");
    return new Decision(
        (String) v.get("key"),
        vars instanceof Map ? new LinkedHashMap<>((Map<String, Object>) vars) : new LinkedHashMap<>());
  }

  public void track(String event, String userId) {
    track(event, userId, null, null);
  }

  /**
   * Evento do usuário. Também vira conversão nas campanhas server-side em que ele está e que têm meta customizada
   * com este nome.
   *
   * @param value valor (receita) ou null
   * @param props propriedades (String, número ou Boolean) ou null
   */
  @SuppressWarnings("unchecked")
  public void track(String event, String userId, Double value, Map<String, ?> props) {
    List<Map<String, Object>> events = new ArrayList<>();
    Map<String, Object> ev = base(userId);
    ev.put("type", "event");
    ev.put("name", event);
    if (value != null) ev.put("value", value);
    if (props != null) ev.put("props", new LinkedHashMap<>(props));
    events.add(ev);
    Map<String, Object> c = config;
    Object exps = c == null ? null : c.get("experiments");
    if (exps instanceof List) {
      for (Object x : (List<Object>) exps) {
        Map<String, Object> exp = (Map<String, Object>) x;
        Map<String, Object> v = Bucketing.chooseVariation(userId, exp);
        if (v == null || !(exp.get("goals") instanceof List)) continue;
        for (Object gx : (List<Object>) exp.get("goals")) {
          Map<String, Object> g = (Map<String, Object>) gx;
          if (!"custom".equals(g.get("type")) || !event.equals(g.get("event"))) continue;
          Map<String, Object> conv = base(userId);
          conv.put("type", "conversion");
          conv.put("experimentId", exp.get("id"));
          conv.put("experimentKey", exp.get("key"));
          conv.put("variationId", v.get("id"));
          conv.put("variationKey", v.get("key"));
          conv.put("goalId", g.get("id"));
          conv.put("goalKey", g.get("key"));
          if (value != null) conv.put("value", value);
          events.add(conv);
        }
      }
    }
    synchronized (lock) {
      queue.addAll(events);
    }
  }

  /** Envia agora os eventos pendentes (em falha de rede, voltam para a fila). */
  public void flush() {
    Map<String, Object> c = config;
    Object url = c == null ? null : c.get("trackingUrl");
    List<Map<String, Object>> events;
    synchronized (lock) {
      if (queue.isEmpty() || !(url instanceof String) || ((String) url).isEmpty()) return;
      events = queue;
      queue = new ArrayList<>();
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("events", events);
    try {
      transport.send("POST", (String) url, Json.stringify(body));
    } catch (Exception e) {
      synchronized (lock) {
        events.addAll(queue);
        queue = events;
      }
    }
  }

  /** Para os timers e envia o que falta. */
  @Override
  public void close() {
    timers.shutdownNow();
    try {
      timers.awaitTermination(5, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    flush();
  }

  private Map<String, Object> base(String userId) {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("eventId", UUID.randomUUID().toString());
    e.put("ts", System.currentTimeMillis());
    e.put("accountId", accountId);
    e.put("visitorId", userId);
    e.put("url", "sdk://server");
    return e;
  }
}
