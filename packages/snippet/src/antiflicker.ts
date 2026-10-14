/** Atributo colocado no elemento quando sua alteração foi aplicada: libera a visibilidade dele. */
export const OK_ATTR = 'data-abt-ok';

export interface AntiFlicker {
  /** Libera um elemento já alterado. */
  reveal(el: Element): void;
  /** Remove o esconderijo (tudo aplicado ou timeout). */
  release(): void;
}

/**
 * Injeta, de forma síncrona, um <style> que esconde SÓ os seletores alterados (modo "element")
 * ou a página inteira (modo "page"), até cada elemento ser liberado ou o timeout de segurança expirar.
 */
export function hide(
  doc: Document,
  selectors: string[],
  mode: 'element' | 'page',
  timeoutMs: number,
): AntiFlicker {
  const style = doc.createElement('style');
  style.setAttribute('data-abt-antiflicker', mode);
  style.textContent =
    mode === 'page'
      ? 'html{opacity:0!important}'
      : // Uma regra por seletor: um seletor inválido não derruba os outros.
        selectors.map((s) => `:is(${s}):not([${OK_ATTR}]){visibility:hidden!important}`).join('\n');
  (doc.head ?? doc.documentElement).appendChild(style);
  const timer = setTimeout(() => release(), timeoutMs);
  const release = () => {
    clearTimeout(timer);
    style.remove();
  };
  return { reveal: (el) => el.setAttribute(OK_ATTR, ''), release };
}
