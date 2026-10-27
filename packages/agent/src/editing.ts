import type { OperationDraft, Target } from '@abtest/shared';
import { INSERTED_ATTR } from '@abtest/snippet/engine';
import { elementInfo } from './inspect';
import type { MenuItem, Overlay } from './overlay';
import { createResize } from './resize';

export interface EditContext {
  win: Window;
  overlay: Overlay;
  selected(): Element | null;
  select(el: Element | null): void;
  /** Envia um rascunho de operação ao app (o app numera, guarda e reaplica a variação). */
  emit(draft: OperationDraft): void;
  prompt(kind: 'html' | 'image', title: string, initial?: string): Promise<string | null>;
}

const VOID =
  /^(IMG|INPUT|BR|HR|META|LINK|AREA|BASE|COL|EMBED|SOURCE|TRACK|WBR|TEXTAREA|SELECT|IFRAME|VIDEO|AUDIO|CANVAS|SVG)$/i;
const targetOf = (el: Element): Target => elementInfo(el).target;

/** innerHTML sem os nós inseridos pela variação (eles já vêm de um insertHTML; copiá-los duplicaria). */
export function cleanHTML(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(`[${INSERTED_ATTR}]`).forEach((n) => n.remove());
  return copy.innerHTML;
}

/**
 * Interações de edição sobre a página real. O agent NUNCA altera o DOM de forma definitiva por conta própria:
 * cada ação vira um rascunho de operação; o app devolve a lista completa e o agent reaplica (fonte única da verdade).
 */
export function createEditing(ctx: EditContext) {
  const { win, overlay } = ctx;
  const doc = win.document;
  let editing: { el: HTMLElement; html: string; text: string; target: Target; hadChildren: boolean } | null =
    null;
  let drag: { el: Element; anchor?: Element; position?: 'before' | 'after' | 'append' } | null = null;
  let swallowClick = false;
  const resize = createResize(win, overlay.root, ctx.emit, targetOf);

  // ---------- Edição de texto inline ----------
  const finishEdit = (commit: boolean) => {
    if (!editing) return;
    const { el, html, text, target, hadChildren } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    const value = hadChildren ? cleanHTML(el) : (el.textContent ?? '');
    const before = Object.assign(doc.createElement('div'), { innerHTML: html });
    el.innerHTML = html; // volta ao original: a alteração chega pela variação reaplicada
    if (commit && value !== (hadChildren ? cleanHTML(before) : text))
      ctx.emit(hadChildren ? { type: 'setHTML', target, value } : { type: 'setText', target, value });
    overlay.refresh();
  };

  const startEdit = (el: Element) => {
    if (!(el instanceof HTMLElement) || VOID.test(el.tagName)) return;
    finishEdit(true);
    editing = {
      el,
      html: el.innerHTML,
      text: el.textContent ?? '',
      target: targetOf(el),
      hadChildren: el.children.length > 0,
    };
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    win.getSelection()?.removeAllRanges();
    win.getSelection()?.addRange(range);
  };

  const onKey = (e: KeyboardEvent) => {
    if (editing && e.key === 'Escape') finishEdit(false);
    else if (editing && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finishEdit(true);
    } else if (drag && e.key === 'Escape') endDrag(false);
    else if (e.key === 'Escape' && resize.cancel()) return;
    else if (e.key === 'Escape') overlay.hideMenu();
  };
  const onFocusOut = (e: FocusEvent) => {
    if (editing && e.target === editing.el) finishEdit(true);
  };

  // ---------- Arrastar para mover ----------
  const dropTarget = (x: number, y: number) => {
    for (const el of doc.elementsFromPoint(x, y)) {
      if (overlay.contains(el) || el === doc.documentElement || drag!.el === el || drag!.el.contains(el))
        continue;
      const r = el.getBoundingClientRect();
      const rel = r.height ? (y - r.top) / r.height : 0.5;
      const canContain = !VOID.test(el.tagName) && el !== doc.body;
      const position: 'before' | 'after' | 'append' =
        rel < 0.25 || (!canContain && rel < 0.5) ? 'before' : rel > 0.75 || !canContain ? 'after' : 'append';
      return el === doc.body ? { el, position: 'append' as const } : { el, position };
    }
    return null;
  };
  const onDragMove = (e: PointerEvent) => {
    if (!drag) return;
    const t = dropTarget(e.clientX, e.clientY);
    drag.anchor = t?.el;
    drag.position = t?.position;
    overlay.setDrop(t?.el ?? null, t?.position);
  };
  const endDrag = (commit: boolean) => {
    if (!drag) return;
    const { el, anchor, position } = drag;
    drag = null;
    overlay.setDrop(null);
    doc.documentElement.style.removeProperty('cursor');
    if (commit && anchor && position) {
      swallowClick = true;
      ctx.emit({ type: 'move', target: targetOf(el), value: { position, anchor: targetOf(anchor) } });
    }
  };
  const onDragUp = (e: PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    endDrag(true);
  };
  overlay.onHandleDown((e) => {
    const el = ctx.selected();
    if (!el) return;
    e.preventDefault();
    drag = { el };
    doc.documentElement.style.setProperty('cursor', 'grabbing');
  });

  // ---------- Menu de contexto ----------
  const copy = async (text: string) => {
    try {
      await win.navigator.clipboard.writeText(text);
    } catch {
      const ta = doc.createElement('textarea');
      ta.value = text;
      overlay.root.appendChild(ta);
      ta.select();
      try {
        doc.execCommand('copy');
      } catch {
        /* sem clipboard: o seletor fica visível no aviso */
      }
      ta.remove();
    }
    overlay.toast(`Seletor copiado: ${text}`);
  };

  const insert = async (el: Element, position: 'before' | 'after') => {
    const html = await ctx.prompt(
      'html',
      position === 'before' ? 'HTML a inserir antes' : 'HTML a inserir depois',
    );
    if (html) ctx.emit({ type: 'insertHTML', target: targetOf(el), value: { position, html } });
  };

  const editHTML = async (el: Element) => {
    const initial = cleanHTML(el);
    const html = await ctx.prompt('html', `Editar HTML de <${el.tagName.toLowerCase()}>`, initial);
    if (html !== null && html !== initial) ctx.emit({ type: 'setHTML', target: targetOf(el), value: html });
  };

  const menuFor = (el: Element): MenuItem[] => {
    const items: MenuItem[] = [];
    if (!VOID.test(el.tagName))
      items.push(
        { id: 'edit', label: 'Editar texto', run: () => startEdit(el) },
        { id: 'edit-html', label: 'Editar HTML', run: () => editHTML(el) },
      );
    if (el.tagName === 'IMG')
      items.push({
        id: 'image',
        label: 'Trocar imagem',
        run: async () => {
          const src = await ctx.prompt('image', 'URL da nova imagem', el.getAttribute('src') ?? '');
          if (src) ctx.emit({ type: 'replaceImage', target: targetOf(el), value: { src } });
        },
      });
    items.push(
      { id: 'hide', label: 'Esconder', run: () => ctx.emit({ type: 'hide', target: targetOf(el) }) },
      { id: 'remove', label: 'Remover', run: () => ctx.emit({ type: 'remove', target: targetOf(el) }) },
      { id: 'resize', label: 'Mover / redimensionar', run: () => resize.open(el) },
      { id: 'insert-before', label: 'Inserir HTML antes', run: () => insert(el, 'before') },
      { id: 'insert-after', label: 'Inserir HTML depois', run: () => insert(el, 'after') },
      { id: 'copy', label: 'Copiar seletor', run: () => copy(targetOf(el).selector) },
    );
    if (el.parentElement && el.parentElement !== doc.documentElement)
      items.push({ id: 'parent', label: 'Selecionar pai', run: () => ctx.select(el.parentElement) });
    return items;
  };

  win.addEventListener('keydown', onKey, true);
  win.addEventListener('focusout', onFocusOut, true);
  // Registrados ANTES do bloqueio de eventos do agent: o bloqueio usa stopImmediatePropagation.
  win.addEventListener('pointermove', onDragMove, true);
  win.addEventListener('pointerup', onDragUp, true);

  return {
    /** Evento dentro do elemento em edição: o site não recebe, mas o comportamento nativo (cursor, digitação) segue. */
    isEditing: (t: EventTarget | null) => !!editing && t instanceof Node && editing.el.contains(t),
    isDragging: () => !!drag,
    /** Clique gerado ao soltar um arraste não deve selecionar o elemento de destino. */
    consumeClick: () => {
      const s = swallowClick;
      swallowClick = false;
      return s;
    },
    startEdit,
    openMenu: (el: Element, x: number, y: number) => overlay.showMenu(x, y, menuFor(el)),
    finishEdit,
    destroy() {
      finishEdit(false);
      resize.destroy();
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('focusout', onFocusOut, true);
      win.removeEventListener('pointermove', onDragMove, true);
      win.removeEventListener('pointerup', onDragUp, true);
    },
  };
}
