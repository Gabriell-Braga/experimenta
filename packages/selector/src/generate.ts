import { isStableAttrValue, isStableClass, isStableId } from './stability';

export type Fragility = 'low' | 'medium' | 'high';

export interface SelectorCandidate {
  selector: string;
  /** Qual regra gerou o seletor (para depuração e indicador no editor). */
  strategy: 'id' | 'data' | 'attr' | 'class' | 'anchored' | 'nth';
  fragility: Fragility;
}

export interface GeneratedSelector {
  selector: string;
  alternates: string[];
  fragility: Fragility;
  candidates: SelectorCandidate[];
}

/** Atributos data-* preferidos, em ordem. Outros data-* com valor estável também servem. */
const PREFERRED_DATA = [
  'data-testid',
  'data-test',
  'data-test-id',
  'data-cy',
  'data-qa',
  'data-id',
  'data-track',
];
/** Atributos semânticos aceitos combinados com a tag. */
const SEMANTIC_ATTRS = ['name', 'aria-label', 'alt', 'title', 'href', 'for', 'type', 'role', 'placeholder'];
/** data-* que não identificam o elemento (estado, framework). */
const IGNORED_DATA =
  /^data-(v-|reactid|reactroot|state|active|selected|open|headlessui|radix|emotion|styled)/;

export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value
    .replace(/[^a-zA-Z0-9_ -￿-]/g, (c) => `\\${c}`)
    .replace(/^(-?)(\d)/, (_, dash: string, d: string) => `${dash}\\3${d} `);
}

const attrSel = (name: string, value: string) => `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`;

function isUnique(selector: string, el: Element, root: ParentNode): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

const tagOf = (el: Element) => el.tagName.toLowerCase();

/** Seletores candidatos que identificam o elemento sozinho (sem ancestrais), do mais forte ao mais fraco. */
function ownCandidates(el: Element): SelectorCandidate[] {
  const tag = tagOf(el);
  const out: SelectorCandidate[] = [];
  if (el.id && isStableId(el.id))
    out.push({ selector: `#${cssEscape(el.id)}`, strategy: 'id', fragility: 'low' });

  const dataAttrs = [...el.attributes]
    .filter((a) => a.name.startsWith('data-') && !IGNORED_DATA.test(a.name) && isStableAttrValue(a.value))
    .sort((a, b) => rank(a.name) - rank(b.name));
  for (const a of dataAttrs)
    out.push({ selector: attrSel(a.name, a.value), strategy: 'data', fragility: 'low' });

  for (const name of SEMANTIC_ATTRS) {
    const v = el.getAttribute(name);
    if (v && isStableAttrValue(v))
      out.push({ selector: tag + attrSel(name, v), strategy: 'attr', fragility: 'medium' });
  }

  const classes = [...el.classList].filter(isStableClass).map((c) => `.${cssEscape(c)}`);
  for (const c of classes) out.push({ selector: tag + c, strategy: 'class', fragility: 'medium' });
  for (let i = 0; i < classes.length; i++)
    for (let j = i + 1; j < classes.length; j++)
      out.push({ selector: tag + classes[i] + classes[j], strategy: 'class', fragility: 'medium' });
  return out;
}

function rank(name: string): number {
  const i = PREFERRED_DATA.indexOf(name);
  return i === -1 ? PREFERRED_DATA.length : i;
}

/** Passo de caminho para `el`: tag + classe estável (se houver) + nth-of-type quando há irmãos de mesma tag. */
function step(el: Element): string {
  const tag = tagOf(el);
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
  return sameTag.length === 1 ? tag : `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

/** Caminho completo por nth-of-type a partir de <body> (ou da raiz). Sempre único. Último recurso. */
export function nthPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.parentElement && tagOf(cur) !== 'body') {
    parts.unshift(step(cur));
    cur = cur.parentElement;
  }
  return parts.length ? (cur && tagOf(cur) === 'body' ? 'body > ' : '') + parts.join(' > ') : tagOf(el);
}

/**
 * Gera o seletor principal e alternativos com a prioridade:
 * id estável → data-* → atributos/classes estáveis → caminho curto ancorado no ancestral estável → nth-of-type.
 */
export function generateSelector(el: Element, root: ParentNode = el.ownerDocument!): GeneratedSelector {
  const unique: SelectorCandidate[] = ownCandidates(el).filter((c) => isUnique(c.selector, el, root));

  if (unique.length < 3) {
    // Ancora no ancestral mais próximo com seletor único e estável.
    let anc = el.parentElement;
    let depth = 0;
    while (anc && tagOf(anc) !== 'html' && depth < 6) {
      const anchor = ownCandidates(anc).find((c) => isUnique(c.selector, anc!, root));
      if (anchor) {
        const own = ownCandidates(el).filter((c) => c.strategy !== 'id');
        const descendant = [
          ...own.map((c) => `${anchor.selector} ${c.selector}`),
          `${anchor.selector} ${tagOf(el)}`,
        ];
        const found = descendant.find((s) => isUnique(s, el, root));
        if (found) unique.push({ selector: found, strategy: 'anchored', fragility: 'medium' });
        else {
          const path: string[] = [];
          for (let cur: Element = el; cur !== anc; cur = cur.parentElement!) path.unshift(step(cur));
          const s = `${anchor.selector} > ${path.join(' > ')}`;
          if (isUnique(s, el, root))
            unique.push({
              selector: s,
              strategy: 'anchored',
              fragility: s.includes('nth-of-type') ? 'high' : 'medium',
            });
        }
        break;
      }
      anc = anc.parentElement;
      depth++;
    }
  }

  const nth = nthPath(el);
  if (!unique.some((c) => c.selector === nth))
    unique.push({ selector: nth, strategy: 'nth', fragility: 'high' });

  const [primary, ...rest] = unique;
  return {
    selector: primary!.selector,
    alternates: rest.slice(0, 3).map((c) => c.selector),
    fragility: primary!.fragility,
    candidates: unique,
  };
}
