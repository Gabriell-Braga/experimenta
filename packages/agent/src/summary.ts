import { fingerprint, generateSelector, normText, resolveTarget } from '@abtest/selector';
import {
  type HeatmapContext,
  PAGE_ELEMENTS_MAX,
  PAGE_SUMMARY_CHARS,
  type PageElement,
  type PageSnapshot,
  type Target,
} from '@abtest/shared';
import { HOST_TAG } from './overlay';

/** Sempre entram (se visíveis): o que se costuma pedir para mudar. */
const ALWAYS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'A',
  'BUTTON',
  'IMG',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'LABEL',
]);
/** Blocos da página (mover/esconder seções): entram com o começo do texto. */
const LANDMARKS = new Set(['HEADER', 'NAV', 'MAIN', 'SECTION', 'FOOTER', 'FORM', 'ASIDE', 'ARTICLE']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS']);
const ATTRS = ['id', 'class', 'href', 'src', 'alt', 'placeholder', 'type', 'name', 'aria-label', 'role'];
const STYLES = ['color', 'background-color', 'font-size', 'font-weight'];

const ownText = (el: Element) =>
  [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');

/** Texto visível do elemento com espaço entre os nós (textContent cola "Título" e "Ir"), até `max`. */
function textOf(el: Element, max: number) {
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = w.nextNode(); n && out.length < max; n = w.nextNode())
    if (!SKIP.has(n.parentElement?.tagName.toUpperCase() ?? '')) out += ` ${n.textContent ?? ''}`;
  return normText(out).slice(0, max);
}

/**
 * Resumo compacto do DOM visível para a IA: elementos relevantes na ordem do documento, com `ref` curto,
 * texto, alguns atributos e estilos. Os alvos (seletor estável + impressão digital) ficam à parte, no app.
 */
export function pageSnapshot(doc: Document): PageSnapshot {
  const win = doc.defaultView!;
  const elements: PageElement[] = [];
  const targets: Record<string, Target> = {};
  let size = 2;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, {
    // display:none esconde a subárvore toda: nem desce nela.
    acceptNode: (n) =>
      SKIP.has((n as Element).tagName.toUpperCase()) ||
      (n as Element).localName === HOST_TAG ||
      win.getComputedStyle(n as Element).display === 'none'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n && elements.length < PAGE_ELEMENTS_MAX; n = walker.nextNode()) {
    const el = n as Element;
    const tag = el.tagName;
    const landmark = LANDMARKS.has(tag);
    if (!ALWAYS.has(tag) && !landmark && !ownText(el)) continue;
    const cs = win.getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    const ref = `e${elements.length + 1}`;
    const attrs: Record<string, string> = {};
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = (a === 'class' ? v.trim().split(/\s+/).slice(0, 3).join(' ') : v).slice(0, 200);
    }
    const styles: Record<string, string> = {};
    for (const p of STYLES) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'rgba(0, 0, 0, 0)') styles[p] = v.slice(0, 80);
    }
    const item = { ref, tag: tag.toLowerCase(), text: textOf(el, landmark ? 60 : 80), attrs, styles };
    size += JSON.stringify(item).length + 1;
    if (size > PAGE_SUMMARY_CHARS) break;
    elements.push(item);
    const gen = generateSelector(el);
    targets[ref] = { selector: gen.selector, alternates: gen.alternates, fingerprint: fingerprint(el) };
  }
  return { url: win.location.href.slice(0, 2000), title: doc.title.slice(0, 200), elements, targets };
}

/** Nome legível de um elemento: aria-label, texto visível, alt/title ou o valor de botão. */
const labelOf = (el: Element) =>
  normText(
    el.getAttribute('aria-label') ||
      textOf(el, 80) ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      (el instanceof HTMLInputElement ? el.value : '') ||
      '',
  ).slice(0, 80);

const CLICKABLE = 'a[href],button,[role=button],input[type=submit],input[type=button]';

/**
 * Para o resumo do mapa de calor (IA): o texto de cada elemento clicado (os seletores do mapa) e os
 * clicáveis visíveis que não estão entre eles nem dentro deles (o que é ignorado), até 30.
 */
export function heatmapContext(doc: Document, selectors: string[]): HeatmapContext {
  const win = doc.defaultView!;
  const labels: Record<string, string> = {};
  const clicked: Element[] = [];
  for (const selector of selectors) {
    const el = resolveTarget({ selector, alternates: [] }, doc)?.el;
    if (!el) continue;
    clicked.push(el);
    const l = labelOf(el);
    if (l) labels[selector] = l;
  }
  const hidden = (el: Element) => {
    if (win.getComputedStyle(el).visibility === 'hidden') return true;
    for (let p: Element | null = el; p; p = p.parentElement)
      if (win.getComputedStyle(p).display === 'none') return true;
    return false;
  };
  const ignored: string[] = [];
  for (const el of doc.querySelectorAll(CLICKABLE)) {
    if (ignored.length >= 30) break;
    if (clicked.some((c) => c === el || c.contains(el) || el.contains(c)) || hidden(el)) continue;
    const l = labelOf(el);
    if (l && !ignored.includes(l)) ignored.push(l);
  }
  return { labels, ignored };
}
