import { fingerprint, generateSelector } from '@abtest/selector';
import type { ElementInfo } from '@abtest/shared';

/** Estilos computados mostrados/editados no painel de propriedades. */
export const STYLE_PROPS = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-radius',
  'width',
  'height',
  'display',
  'opacity',
] as const;

/** Rótulo curto: tag#id.classe1.classe2 (máx. 2 classes). */
export function labelOf(el: Element): string {
  const cls = [...el.classList]
    .filter((c) => !c.startsWith('abt-'))
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + cls;
}

export function elementInfo(el: Element): ElementInfo {
  const gen = generateSelector(el);
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p);
  const attributes: Record<string, string> = {};
  for (const a of el.attributes)
    if (a.name !== 'style' && !a.name.startsWith('data-abt')) attributes[a.name] = a.value;
  const breadcrumb: ElementInfo['breadcrumb'] = [];
  for (let p = el.parentElement; p && p.tagName !== 'HTML'; p = p.parentElement)
    breadcrumb.push({ label: labelOf(p), selector: generateSelector(p).selector });
  return {
    target: { selector: gen.selector, alternates: gen.alternates, fingerprint: fingerprint(el) },
    fragility: gen.fragility,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? '').trim().slice(0, 500),
    textOnly: el.children.length === 0,
    attributes,
    styles,
    isImage: el.tagName === 'IMG',
    breadcrumb,
  };
}
