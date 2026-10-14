import type { Operation, Position } from '@abtest/shared';

/** Desfaz uma operação aplicada. */
export type Undo = () => void;

/** Marca nós criados por insertHTML (permite ao agent ignorá-los e ao revert removê-los). */
export const INSERTED_ATTR = 'data-abt-inserted';

function place(node: Node, ref: Element, position: Position): void {
  if (position === 'before') ref.before(node);
  else if (position === 'after') ref.after(node);
  else if (position === 'prepend') ref.prepend(node);
  else ref.append(node);
}

function snapshotChildren(el: Element): Undo {
  const orig = [...el.childNodes];
  return () => el.replaceChildren(...orig);
}

function snapshotPlace(el: Element): Undo {
  const parent = el.parentNode;
  const next = el.nextSibling;
  return () => {
    if (parent) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
  };
}

function snapshotAttrs(el: Element, names: string[]): Undo {
  const prev = names.map((n) => [n, el.getAttribute(n)] as const);
  return () => {
    for (const [n, v] of prev) {
      if (v === null) el.removeAttribute(n);
      else el.setAttribute(n, v);
    }
  };
}

function setStyles(el: HTMLElement, styles: Record<string, string>): Undo {
  const undo = snapshotAttrs(el, ['style']);
  for (const [prop, value] of Object.entries(styles)) {
    if (value === '') el.style.removeProperty(prop);
    // !important: a variação precisa vencer o CSS do site.
    else el.style.setProperty(prop, value, 'important');
  }
  return undo;
}

/**
 * Aplica UMA operação a um elemento já resolvido. `anchor` só é usado por `move`.
 * Retorna a função que desfaz a alteração.
 */
export function applyToElement(op: Operation, el: Element, anchor?: Element): Undo {
  const html = el as HTMLElement;
  switch (op.type) {
    case 'setText': {
      const undo = snapshotChildren(el);
      el.textContent = op.value;
      return undo;
    }
    case 'setHTML': {
      const undo = snapshotChildren(el);
      el.innerHTML = op.value;
      return undo;
    }
    case 'setStyle':
      return setStyles(html, op.value);
    case 'setAttribute': {
      const undo = snapshotAttrs(el, [op.value.name]);
      if (op.value.value === null) el.removeAttribute(op.value.name);
      else el.setAttribute(op.value.name, op.value.value);
      return undo;
    }
    case 'addClass': {
      if (el.classList.contains(op.value)) return () => {};
      el.classList.add(op.value);
      return () => el.classList.remove(op.value);
    }
    case 'removeClass': {
      if (!el.classList.contains(op.value)) return () => {};
      el.classList.remove(op.value);
      return () => el.classList.add(op.value);
    }
    case 'hide':
      return setStyles(html, { display: 'none' });
    case 'remove': {
      const undo = snapshotPlace(el);
      el.remove();
      return undo;
    }
    case 'move': {
      if (!anchor) throw new Error('move sem âncora');
      const undo = snapshotPlace(el);
      place(el, anchor, op.value.position);
      return undo;
    }
    case 'insertHTML': {
      const tpl = el.ownerDocument.createElement('template');
      tpl.innerHTML = op.value.html;
      const nodes = [...tpl.content.childNodes];
      for (const n of nodes) if (n instanceof Element) n.setAttribute(INSERTED_ATTR, op.id);
      const frag = el.ownerDocument.createDocumentFragment();
      frag.append(...nodes);
      place(frag, el, op.value.position);
      return () => nodes.forEach((n) => n.parentNode?.removeChild(n));
    }
    case 'replaceImage': {
      const undo = snapshotAttrs(el, ['src', 'srcset', 'alt']);
      el.setAttribute('src', op.value.src);
      if (op.value.srcset) el.setAttribute('srcset', op.value.srcset);
      else el.removeAttribute('srcset');
      if (op.value.alt !== undefined) el.setAttribute('alt', op.value.alt);
      return undo;
    }
  }
}
