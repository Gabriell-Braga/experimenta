import { labelOf } from './inspect';

export const HOST_TAG = 'abt-editor-overlay';

const CSS = `
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646}
.box{position:fixed;box-sizing:border-box;pointer-events:none;display:none}
.hover{border:2px dashed #3b82f6;background:#3b82f61a}
.sel{border:2px solid #f97316}
.label{position:fixed;display:none;font:11px/1.6 ui-monospace,monospace;background:#3b82f6;color:#fff;padding:0 6px;border-radius:3px;white-space:nowrap;pointer-events:none}
.label.sel-label{background:#f97316}
.crumbs{position:fixed;left:0;right:0;bottom:0;display:none;gap:2px;flex-wrap:wrap;padding:4px 8px;background:#111827ee;font:12px/1.6 system-ui,sans-serif;pointer-events:auto}
.crumbs button{all:unset;cursor:pointer;color:#e5e7eb;padding:0 6px;border-radius:3px}
.crumbs button:hover{background:#374151}
.crumbs button.cur{color:#fdba74}
.crumbs span{color:#6b7280}
`;

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  setHover(el: Element | null): void;
  setSelected(el: Element | null, onCrumb: (el: Element) => void): void;
  /** Recalcula posições (scroll/resize/mutação). */
  refresh(): void;
  contains(node: EventTarget | null): boolean;
  destroy(): void;
}

/** UI do agent isolada num Shadow DOM: o CSS do site não a afeta e ela não afeta o site. */
export function createOverlay(doc: Document): Overlay {
  const host = doc.createElement(HOST_TAG);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="box hover"></div><div class="label hover-label"></div>
    <div class="box sel"></div><div class="label sel-label"></div>
    <div class="crumbs" role="navigation" aria-label="Ancestrais"></div>`;
  doc.documentElement.appendChild(host);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const [hoverBox, hoverLabel, selBox, selLabel, crumbs] = [
    '.hover',
    '.hover-label',
    '.sel',
    '.sel-label',
    '.crumbs',
  ].map($) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  let hovered: Element | null = null;
  let selected: Element | null = null;

  const place = (box: HTMLElement, label: HTMLElement, el: Element | null) => {
    if (!el || !el.isConnected) {
      box.style.display = label.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    label.textContent = labelOf(el);
    Object.assign(label.style, {
      display: 'block',
      left: `${Math.max(0, r.left)}px`,
      top: `${r.top >= 20 ? r.top - 20 : r.bottom + 2}px`,
    });
  };

  const refresh = () => {
    place(hoverBox, hoverLabel, hovered && hovered !== selected ? hovered : null);
    place(selBox, selLabel, selected);
  };
  const onViewport = () => refresh();
  doc.defaultView?.addEventListener('scroll', onViewport, true);
  doc.defaultView?.addEventListener('resize', onViewport);

  return {
    host,
    root,
    setHover(el) {
      hovered = el;
      refresh();
    },
    setSelected(el, onCrumb) {
      selected = el;
      crumbs.replaceChildren();
      crumbs.style.display = el ? 'flex' : 'none';
      if (el) {
        const chain: Element[] = [];
        for (let p: Element | null = el; p && p.tagName !== 'HTML'; p = p.parentElement) chain.unshift(p);
        chain.forEach((node, i) => {
          if (i) crumbs.append(Object.assign(doc.createElement('span'), { textContent: '›' }));
          const b = doc.createElement('button');
          b.textContent = labelOf(node);
          if (node === el) b.className = 'cur';
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            onCrumb(node);
          });
          crumbs.append(b);
        });
      }
      refresh();
    },
    refresh,
    contains: (node) => node === host || (node instanceof Node && host.contains(node)),
    destroy() {
      doc.defaultView?.removeEventListener('scroll', onViewport, true);
      doc.defaultView?.removeEventListener('resize', onViewport);
      host.remove();
    },
  };
}
