// Heurísticas para detectar ids/classes gerados automaticamente (hashes, CSS-in-JS, CSS Modules, frameworks).

const GENERATED_PATTERNS: RegExp[] = [
  /^css-[a-z0-9]+/i, // emotion: css-1x2y3z, css-abc123-Button
  /^sc-[a-z0-9]+/i, // styled-components
  /^jsx-\d+/, // styled-jsx
  /^(svelte|astro)-[a-z0-9]{4,}$/i, // svelte/astro scoped
  /^_?[a-z0-9]{1,}_[a-z0-9]{4,}_[a-z0-9]{1,}$/i, // vite CSS Modules: _btn_x7a2f_12
  /__[a-z0-9_-]*[0-9][a-z0-9_-]*$/i, // CSS Modules webpack: Button__root__3xYz1
  /^(ember|ext-gen|yui_|gwt-uid-|mui-|radix-|headlessui-|react-select-)\d*/i,
  /^:r[a-z0-9]+:$/i, // React useId
  /^[a-f0-9]{6,}$/i, // hex puro
  /^[0-9]/, // começa com dígito
  /\d{4,}/, // sequência longa de dígitos (timestamps, contadores)
  /[a-f0-9]{8}-[a-f0-9]{4}-/i, // uuid
];

/** Classes de estado: mudam com a interação, não servem para identificar o elemento. */
const STATE_CLASSES =
  /^(is-|has-)|^(active|hover|focus|focused|open|opened|closed|selected|current|disabled|visible|hidden|show|collapsed|expanded|loading|loaded)$/i;

/** Proporção dígitos/letras alta num token curto sem separadores = hash ("a1b2c3", "x9Kq2"). */
function looksLikeHash(token: string): boolean {
  const parts = token.split(/[-_]/);
  return parts.some((p) => {
    if (p.length < 5) return false;
    const digits = (p.match(/\d/g) ?? []).length;
    const letters = (p.match(/[a-z]/gi) ?? []).length;
    const caseMix =
      /[a-z]/.test(p) && /[A-Z]/.test(p) && /^[a-zA-Z0-9]+$/.test(p) && p !== p[0] + p.slice(1).toLowerCase();
    return (digits >= 2 && letters >= 2) || (caseMix && digits >= 1);
  });
}

export function isGeneratedToken(token: string): boolean {
  return !token || GENERATED_PATTERNS.some((r) => r.test(token)) || looksLikeHash(token);
}

export function isStableClass(cls: string): boolean {
  return !isGeneratedToken(cls) && !STATE_CLASSES.test(cls) && !cls.startsWith('abt-');
}

export function isStableId(id: string): boolean {
  return !isGeneratedToken(id);
}

/** Valor de atributo que vale usar em seletor: curto, sem quebra de linha e sem cara de hash. */
export function isStableAttrValue(v: string): boolean {
  return (
    v.length > 0 && v.length <= 80 && !/[\n\r]/.test(v) && !isGeneratedToken(v.replace(/[\s/.:?=&#]+/g, '-'))
  );
}
