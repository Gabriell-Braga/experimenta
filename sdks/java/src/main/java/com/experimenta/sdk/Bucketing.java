package com.experimenta.sdk;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

/**
 * Bucketing determinístico idêntico ao snippet: MurmurHash3 x86 32 bits sobre UTF-8, 10.000 baldes.
 *
 * <p>Aritmética de 32 bits sem sinal: o {@code int} do Java já faz multiplicação módulo 2^32 (igual ao Math.imul
 * do JS); os deslocamentos à direita usam {@code >>>} (lógico, nunca {@code >>}), cada byte entra com {@code &
 * 0xff} (byte do Java tem sinal) e o resultado volta como {@code long} sem sinal.
 */
public final class Bucketing {
  private Bucketing() {}

  public static final int BUCKETS = 10000;

  /** UTF-8 como o TextEncoder do JS: surrogate solto vira U+FFFD. */
  static byte[] utf8(String s) {
    ByteArrayOutputStream out = new ByteArrayOutputStream(s.length() + 8);
    for (int i = 0; i < s.length(); ) {
      int cp = s.codePointAt(i);
      i += Character.charCount(cp);
      if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
      if (cp < 0x80) {
        out.write(cp);
      } else if (cp < 0x800) {
        out.write(0xC0 | (cp >>> 6));
        out.write(0x80 | (cp & 0x3F));
      } else if (cp < 0x10000) {
        out.write(0xE0 | (cp >>> 12));
        out.write(0x80 | ((cp >>> 6) & 0x3F));
        out.write(0x80 | (cp & 0x3F));
      } else {
        out.write(0xF0 | (cp >>> 18));
        out.write(0x80 | ((cp >>> 12) & 0x3F));
        out.write(0x80 | ((cp >>> 6) & 0x3F));
        out.write(0x80 | (cp & 0x3F));
      }
    }
    return out.toByteArray();
  }

  /** MurmurHash3 x86 32 bits (semente 0), de 0 a 2^32-1. */
  @SuppressWarnings("fallthrough")
  public static long murmurhash3(String key) {
    byte[] data = utf8(key);
    final int c1 = 0xcc9e2d51;
    final int c2 = 0x1b873593;
    int len = data.length;
    int nblocks = len >>> 2;
    int h = 0;
    for (int i = 0; i < nblocks; i++) {
      int o = i * 4;
      int k =
          (data[o] & 0xff)
              | ((data[o + 1] & 0xff) << 8)
              | ((data[o + 2] & 0xff) << 16)
              | ((data[o + 3] & 0xff) << 24);
      k *= c1;
      k = Integer.rotateLeft(k, 15);
      k *= c2;
      h ^= k;
      h = Integer.rotateLeft(h, 13);
      h = h * 5 + 0xe6546b64;
    }
    int k = 0;
    int tail = nblocks * 4;
    switch (len & 3) {
      case 3:
        k ^= (data[tail + 2] & 0xff) << 16;
        // fall through
      case 2:
        k ^= (data[tail + 1] & 0xff) << 8;
        // fall through
      case 1:
        k ^= data[tail] & 0xff;
        k *= c1;
        k = Integer.rotateLeft(k, 15);
        k *= c2;
        h ^= k;
        break;
      default:
        break;
    }
    h ^= len;
    h ^= h >>> 16;
    h *= 0x85ebca6b;
    h ^= h >>> 13;
    h *= 0xc2b2ae35;
    h ^= h >>> 16;
    return h & 0xffffffffL;
  }

  /** Balde (0–9999) do visitante para um id (experimento, grupo ou "flag:&lt;chave&gt;"). */
  public static int bucketOf(String visitorId, String salt) {
    return (int) (murmurhash3(visitorId + salt) % BUCKETS);
  }

  /** Math.round do JS (meio arredonda para cima). */
  static long jsRound(double x) {
    double f = Math.floor(x);
    return (long) (x - f >= 0.5 ? f + 1 : f);
  }

  static double num(Object v, double fallback) {
    return v instanceof Number ? ((Number) v).doubleValue() : fallback;
  }

  @SuppressWarnings("unchecked")
  static boolean inGroup(String visitorId, Map<String, Object> exp) {
    Map<String, Object> g = (Map<String, Object>) exp.get("group");
    if (g == null) return true;
    int slot = bucketOf(visitorId, (String) g.get("id")) % 100;
    for (Object s : (List<Object>) g.get("slots")) if (((Number) s).intValue() == slot) return true;
    return false;
  }

  /**
   * Mesma escolha do snippet: grupo exclusivo → tráfego → variação proporcional aos pesos. null = fora.
   *
   * @param exp experimento do sdk.json (id, traffic, variations, group)
   */
  @SuppressWarnings("unchecked")
  public static Map<String, Object> chooseVariation(String visitorId, Map<String, Object> exp) {
    if (!inGroup(visitorId, exp)) return null;
    int b = bucketOf(visitorId, (String) exp.get("id"));
    long included = jsRound(num(exp.get("traffic"), 100) * (BUCKETS / 100));
    if (b >= included) return null;
    List<Map<String, Object>> variations = (List<Map<String, Object>>) exp.get("variations");
    double total = 0;
    for (Map<String, Object> v : variations) total += num(v.get("weight"), 0);
    if (total <= 0) return null;
    double point = ((double) b / included) * total;
    for (Map<String, Object> v : variations) {
      double w = num(v.get("weight"), 0);
      if (point < w) return v;
      point -= w;
    }
    return variations.get(variations.size() - 1);
  }
}
