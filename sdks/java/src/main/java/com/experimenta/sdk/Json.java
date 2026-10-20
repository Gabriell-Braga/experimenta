package com.experimenta.sdk;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JSON mínimo (a stdlib do Java não tem): objetos viram {@link LinkedHashMap}, arrays {@link ArrayList}, números
 * inteiros {@link Long} (ou {@link Double} se não couberem), demais números {@link Double}.
 */
public final class Json {
  private final String s;
  private int i;

  private Json(String s) {
    this.s = s;
  }

  /** Lê um documento JSON. @throws IllegalArgumentException se for inválido. */
  public static Object parse(String text) {
    Json p = new Json(text);
    p.ws();
    Object v = p.value();
    p.ws();
    if (p.i != text.length()) throw p.error("conteúdo depois do fim");
    return v;
  }

  /** Escreve JSON (números no formato do JS, NaN/Infinity viram null como no JSON.stringify). */
  public static String stringify(Object v) {
    StringBuilder b = new StringBuilder();
    write(b, v);
    return b.toString();
  }

  private IllegalArgumentException error(String msg) {
    return new IllegalArgumentException("JSON inválido na posição " + i + ": " + msg);
  }

  private void ws() {
    while (i < s.length()) {
      char c = s.charAt(i);
      if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
      i++;
    }
  }

  private Object value() {
    if (i >= s.length()) throw error("fim inesperado");
    char c = s.charAt(i);
    switch (c) {
      case '{':
        return object();
      case '[':
        return array();
      case '"':
        return string();
      case 't':
        return literal("true", Boolean.TRUE);
      case 'f':
        return literal("false", Boolean.FALSE);
      case 'n':
        return literal("null", null);
      default:
        if (c == '-' || (c >= '0' && c <= '9')) return number();
        throw error("caractere inesperado '" + c + "'");
    }
  }

  private Object literal(String word, Object v) {
    if (!s.startsWith(word, i)) throw error("esperado " + word);
    i += word.length();
    return v;
  }

  private Map<String, Object> object() {
    Map<String, Object> m = new LinkedHashMap<>();
    i++;
    ws();
    if (i < s.length() && s.charAt(i) == '}') {
      i++;
      return m;
    }
    while (true) {
      ws();
      if (i >= s.length() || s.charAt(i) != '"') throw error("esperada chave");
      String k = string();
      ws();
      if (i >= s.length() || s.charAt(i) != ':') throw error("esperado ':'");
      i++;
      ws();
      m.put(k, value());
      ws();
      if (i >= s.length()) throw error("fim inesperado");
      char c = s.charAt(i++);
      if (c == '}') return m;
      if (c != ',') throw error("esperado ',' ou '}'");
    }
  }

  private List<Object> array() {
    List<Object> a = new ArrayList<>();
    i++;
    ws();
    if (i < s.length() && s.charAt(i) == ']') {
      i++;
      return a;
    }
    while (true) {
      ws();
      a.add(value());
      ws();
      if (i >= s.length()) throw error("fim inesperado");
      char c = s.charAt(i++);
      if (c == ']') return a;
      if (c != ',') throw error("esperado ',' ou ']'");
    }
  }

  private String string() {
    StringBuilder b = new StringBuilder();
    i++;
    while (true) {
      if (i >= s.length()) throw error("texto sem fim");
      char c = s.charAt(i++);
      if (c == '"') return b.toString();
      if (c < 0x20) throw error("caractere de controle em texto");
      if (c != '\\') {
        b.append(c);
        continue;
      }
      if (i >= s.length()) throw error("escape sem fim");
      char e = s.charAt(i++);
      switch (e) {
        case '"':
        case '\\':
        case '/':
          b.append(e);
          break;
        case 'b':
          b.append('\b');
          break;
        case 'f':
          b.append('\f');
          break;
        case 'n':
          b.append('\n');
          break;
        case 'r':
          b.append('\r');
          break;
        case 't':
          b.append('\t');
          break;
        case 'u':
          if (i + 4 > s.length()) throw error("\\u incompleto");
          try {
            b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
          } catch (NumberFormatException ex) {
            throw error("\\u inválido");
          }
          i += 4;
          break;
        default:
          throw error("escape inválido");
      }
    }
  }

  private Object number() {
    int start = i;
    if (s.charAt(i) == '-') i++;
    boolean integer = true;
    while (i < s.length()) {
      char c = s.charAt(i);
      if (c >= '0' && c <= '9') {
        i++;
      } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
        integer = false;
        i++;
      } else {
        break;
      }
    }
    String t = s.substring(start, i);
    try {
      if (integer) {
        try {
          return Long.parseLong(t);
        } catch (NumberFormatException tooBig) {
          return Double.parseDouble(t);
        }
      }
      return Double.parseDouble(t);
    } catch (NumberFormatException ex) {
      throw error("número inválido " + t);
    }
  }

  private static void write(StringBuilder b, Object v) {
    if (v == null) {
      b.append("null");
    } else if (v instanceof String) {
      quote(b, (String) v);
    } else if (v instanceof Boolean) {
      b.append(v);
    } else if (v instanceof Double || v instanceof Float) {
      double d = ((Number) v).doubleValue();
      b.append(Double.isNaN(d) || Double.isInfinite(d) ? "null" : Rules.jsNumberString(d));
    } else if (v instanceof Number) {
      b.append(Rules.jsString(v));
    } else if (v instanceof Map) {
      b.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        if (!first) b.append(',');
        first = false;
        quote(b, String.valueOf(e.getKey()));
        b.append(':');
        write(b, e.getValue());
      }
      b.append('}');
    } else if (v instanceof Collection) {
      b.append('[');
      boolean first = true;
      for (Object x : (Collection<?>) v) {
        if (!first) b.append(',');
        first = false;
        write(b, x);
      }
      b.append(']');
    } else {
      quote(b, v.toString());
    }
  }

  private static void quote(StringBuilder b, String s) {
    b.append('"');
    for (int k = 0; k < s.length(); k++) {
      char c = s.charAt(k);
      switch (c) {
        case '"':
          b.append("\\\"");
          break;
        case '\\':
          b.append("\\\\");
          break;
        case '\n':
          b.append("\\n");
          break;
        case '\r':
          b.append("\\r");
          break;
        case '\t':
          b.append("\\t");
          break;
        default:
          if (c < 0x20 || (c >= 0xD800 && c <= 0xDFFF && !paired(s, k))) {
            b.append(String.format("\\u%04x", (int) c));
          } else {
            b.append(c);
          }
      }
    }
    b.append('"');
  }

  /** Surrogate faz parte de um par válido (senão sai escapado, como no JSON.stringify). */
  private static boolean paired(String s, int k) {
    char c = s.charAt(k);
    if (Character.isHighSurrogate(c)) return k + 1 < s.length() && Character.isLowSurrogate(s.charAt(k + 1));
    return k > 0 && Character.isHighSurrogate(s.charAt(k - 1));
  }
}
