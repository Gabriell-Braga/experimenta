import type { Fingerprint } from '@abtest/shared';

/** Atributos que identificam bem um elemento (além de qualquer data-*). */
const KEY_ATTRS = [
  'id',
  'name',
  'href',
  'src',
  'alt',
  'title',
  'role',
  'type',
  'aria-label',
  'placeholder',
  'for',
];

export const normText = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

export function fingerprint(el: Element): Fingerprint {
  const attrs: Record<string, string> = {};
  for (const a of el.attributes)
    if ((KEY_ATTRS.includes(a.name) || a.name.startsWith('data-')) && a.value.length <= 200)
      attrs[a.name] = a.value;
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  return {
    tag: el.tagName.toLowerCase(),
    text: normText(el.textContent),
    attrs,
    pos: {
      x: Math.round(r.left + (win?.scrollX ?? 0)),
      y: Math.round(r.top + (win?.scrollY ?? 0)),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
  };
}
