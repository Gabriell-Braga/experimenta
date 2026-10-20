package com.experimenta.sdk;

import java.util.Map;

/** Variação escolhida numa campanha server-side. */
public final class Decision {
  /** Chave da variação. */
  public final String key;

  /** Igual a {@link #key} (mesmo formato do SDK JS). */
  public final String variation;

  /** Variáveis da variação (cópia; pode alterar). */
  public final Map<String, Object> variables;

  Decision(String key, Map<String, Object> variables) {
    this.key = key;
    this.variation = key;
    this.variables = variables;
  }

  public String getKey() {
    return key;
  }

  public Map<String, Object> getVariables() {
    return variables;
  }

  @Override
  public String toString() {
    return "Decision{key=" + key + ", variables=" + variables + "}";
  }
}
