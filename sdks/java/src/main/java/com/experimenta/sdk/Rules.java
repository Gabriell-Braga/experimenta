package com.experimenta.sdk;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Regras de atributo de flag e as conversões de tipo do JS que elas usam ({@code String(v)}, {@code Number(v)},
 * {@code trim}), para decidir igual ao SDK JS com qualquer atributo.
 */
public final class Rules {
  private Rules() {}

  /** WhiteSpace + LineTerminator do JS (o conjunto do String.prototype.trim). */
  private static final String JS_WS =
      "\t\n\u000B\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A"
          + "\u2028\u2029\u202F\u205F\u3000\uFEFF";

  private static final Pattern DECIMAL =
      Pattern.compile("[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?");
  private static final Pattern RADIX = Pattern.compile("0([xXoObB])([0-9a-fA-F]+)");
  private static final double MAX_SAFE = 9007199254740992.0; // 2^53

  /**
   * Regra (eq, neq, in, contains, gte, lte) com o atributo do usuário. Ausente ou null conta como "undefined":
   * só neq passa.
   */
  public static boolean flagRuleMatches(Map<String, ?> rule, Map<String, ?> attrs) {
    Object v = attrs == null ? null : attrs.get((String) rule.get("attribute"));
    String op = (String) rule.get("op");
    String value = (String) rule.get("value");
    if (v == null) return "neq".equals(op);
    String s = jsString(v);
    switch (op) {
      case "eq":
        return s.equals(value);
      case "neq":
        return !s.equals(value);
      case "in":
        for (String x : value.split(",", -1)) if (jsTrim(x).equals(s)) return true;
        return false;
      case "contains":
        return s.contains(value);
      case "gte":
        return jsNumber(v) >= jsNumber(value);
      case "lte":
        return jsNumber(v) <= jsNumber(value);
      default:
        return false;
    }
  }

  static String jsTrim(String s) {
    int a = 0;
    int b = s.length();
    while (a < b && JS_WS.indexOf(s.charAt(a)) >= 0) a++;
    while (b > a && JS_WS.indexOf(s.charAt(b - 1)) >= 0) b--;
    return s.substring(a, b);
  }

  /** {@code String(v)} do JS para String, Boolean e números. */
  static String jsString(Object v) {
    if (v instanceof String) return (String) v;
    if (v instanceof Boolean) return v.toString();
    if (v instanceof Long || v instanceof Integer || v instanceof Short || v instanceof Byte) {
      long x = ((Number) v).longValue();
      return Math.abs((double) x) <= MAX_SAFE ? Long.toString(x) : jsNumberString((double) x);
    }
    if (v instanceof Number) return jsNumberString(((Number) v).doubleValue());
    return String.valueOf(v);
  }

  /**
   * {@code Number.prototype.toString}: dígitos mais curtos que voltam ao mesmo double, na notação do JS. Não usa
   * Double.toString, que só é "mais curto" a partir do JDK 19.
   */
  static String jsNumberString(double d) {
    if (Double.isNaN(d)) return "NaN";
    if (Double.isInfinite(d)) return d > 0 ? "Infinity" : "-Infinity";
    if (d == 0) return "0";
    String sign = d < 0 ? "-" : "";
    double a = Math.abs(d);
    if (a < MAX_SAFE && a == Math.rint(a)) return sign + Long.toString((long) a);
    BigDecimal exact = new BigDecimal(a);
    BigDecimal shortest = exact;
    for (int p = 1; p <= 17; p++) {
      BigDecimal r = exact.round(new MathContext(p, RoundingMode.HALF_EVEN));
      if (r.doubleValue() == a) {
        shortest = r;
        break;
      }
    }
    shortest = shortest.stripTrailingZeros();
    String digits = shortest.unscaledValue().toString();
    int k = digits.length();
    int n = k - shortest.scale();
    StringBuilder out = new StringBuilder(sign);
    if (k <= n && n <= 21) {
      out.append(digits);
      for (int z = k; z < n; z++) out.append('0');
    } else if (0 < n && n <= 21) {
      out.append(digits, 0, n).append('.').append(digits, n, k);
    } else if (-6 < n && n <= 0) {
      out.append("0.");
      for (int z = n; z < 0; z++) out.append('0');
      out.append(digits);
    } else {
      int e = n - 1;
      out.append(digits.charAt(0));
      if (k > 1) out.append('.').append(digits, 1, k);
      out.append('e').append(e >= 0 ? '+' : '-').append(Math.abs(e));
    }
    return out.toString();
  }

  /** {@code Number(v)} do JS: string vazia = 0, inválida = NaN, aceita 0x/0o/0b e Infinity. */
  static double jsNumber(Object v) {
    if (v instanceof Boolean) return (Boolean) v ? 1 : 0;
    if (v instanceof Number) return ((Number) v).doubleValue();
    String s = jsTrim(String.valueOf(v));
    if (s.isEmpty()) return 0;
    if (s.equals("Infinity") || s.equals("+Infinity")) return Double.POSITIVE_INFINITY;
    if (s.equals("-Infinity")) return Double.NEGATIVE_INFINITY;
    if (DECIMAL.matcher(s).matches()) return Double.parseDouble(s);
    Matcher m = RADIX.matcher(s);
    if (m.matches()) {
      char base = Character.toLowerCase(m.group(1).charAt(0));
      try {
        return new BigInteger(m.group(2), base == 'x' ? 16 : base == 'o' ? 8 : 2).doubleValue();
      } catch (NumberFormatException e) { // dígito inválido para a base (ex.: 0b2)
        return Double.NaN;
      }
    }
    return Double.NaN;
  }
}
