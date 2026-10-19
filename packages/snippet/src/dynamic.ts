// Conteúdo dinâmico: {{fonte.chave|padrão}} nos valores de texto/HTML das operações. Entra no bundle do site.
import type { Operation } from '@abtest/shared';
import { readCookie } from './env';
import type { Profile } from './data';

const TOKEN = /\{\{\s*(attr|query|utm|cookie|js)\.([\w.-]+)\s*(?:\|([^}]*))?\}\}/g;
const URL_ATTR = /^(href|src|action|formaction|srcset|poster|xlink:href)$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Troca os tokens pelos dados do visitante: `attr` (atributos), `query` (URL atual), `utm` (1ª visita, ou a
 * URL atual), `cookie`, `js` (variável global, com pontos). Sem valor → padrão depois do `|`.
 * Valores vindos do visitante (ex.: parâmetro da URL, que qualquer um põe num link) são escapados conforme o
 * contexto: `html` vira entidades, `url` vira encodeURIComponent (evita XSS e `javascript:`).
 */
export function renderTemplate(
  value: string,
  win: Window,
  profile: Profile,
  mode: 'text' | 'html' | 'url',
): string {
  if (!value.includes('{{')) return value;
  let params: URLSearchParams | undefined;
  try {
    params = new URL(win.location.href).searchParams;
  } catch {
    /* URL inválida */
  }
  return value.replace(TOKEN, (_, src: string, key: string, fallback = '') => {
    let v: unknown;
    if (src === 'attr') v = profile.a[key];
    else if (src === 'query') v = params?.get(key);
    else if (src === 'utm') v = params?.get(key) ?? profile.t?.[key];
    else if (src === 'cookie') v = readCookie(win.document, key);
    else {
      v = win;
      for (const k of key.split('.')) v = v == null ? undefined : (v as Record<string, unknown>)[k];
    }
    const s = v === undefined || v === null || v === '' ? fallback.trim() : String(v);
    return mode === 'html' ? esc(s) : mode === 'url' ? encodeURIComponent(s) : s;
  });
}

/** Operações com os tokens resolvidos (só as que têm texto/HTML). */
export function renderOperations(ops: Operation[], win: Window, profile: Profile): Operation[] {
  return ops.map((op) => {
    if (op.type === 'setText' || op.type === 'setHTML')
      return {
        ...op,
        value: renderTemplate(op.value, win, profile, op.type === 'setHTML' ? 'html' : 'text'),
      };
    if (op.type === 'insertHTML')
      return { ...op, value: { ...op.value, html: renderTemplate(op.value.html, win, profile, 'html') } };
    // Atributos de evento (on*) nunca recebem dados do visitante; os de URL recebem codificados.
    if (op.type === 'setAttribute' && op.value.value !== null && !/^on/i.test(op.value.name))
      return {
        ...op,
        value: {
          ...op.value,
          value: renderTemplate(op.value.value, win, profile, URL_ATTR.test(op.value.name) ? 'url' : 'text'),
        },
      };
    return op;
  });
}
