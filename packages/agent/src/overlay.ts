import { labelOf } from './inspect';

export const HOST_TAG = 'abt-editor-overlay';

const CSS = `
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646}
.box{position:fixed;box-sizing:border-box;pointer-events:none;display:none}
.hover{border:2px dashed #3b82f6;background:#3b82f61a}
.sel{border:2px solid #f97316}
.label{position:fixed;display:none;font:11px/1.6 ui-monospace,monospace;background:#3b82f6;color:#fff;padding:0 6px;border-radius:3px;white-space:nowrap;pointer-events:none}
.label.sel-label{background:#f97316}
.handle{position:fixed;display:none;width:20px;height:18px;border-radius:3px;background:#f97316;color:#fff;font:12px/18px system-ui;text-align:center;cursor:grab;pointer-events:auto;user-select:none}
.drop{position:fixed;display:none;pointer-events:none;box-sizing:border-box}
.drop.line{border-top:3px solid #16a34a}
.drop.inside{border:2px dashed #16a34a;background:#16a34a1a}
.crumbs{position:fixed;left:0;right:0;bottom:0;display:none;gap:2px;flex-wrap:wrap;padding:4px 8px;background:#111827ee;font:12px/1.6 system-ui,sans-serif;pointer-events:auto}
.crumbs button{all:unset;cursor:pointer;color:#e5e7eb;padding:0 6px;border-radius:3px}
.crumbs button:hover{background:#374151}
.crumbs button.cur{color:#fdba74}
.crumbs span{color:#6b7280}
.menu{position:fixed;display:none;flex-direction:column;min-width:190px;padding:4px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px #0003;font:13px/1.4 system-ui,sans-serif;pointer-events:auto}
.menu button{all:unset;cursor:pointer;padding:6px 10px;border-radius:5px;color:#111827}
.menu button:hover,.menu button:focus{background:#f3f4f6}
.toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:none;background:#111827;color:#fff;padding:6px 12px;border-radius:6px;font:12px system-ui,sans-serif}
`;

export interface MenuItem {
  id: string;
  label: string;
  run(): void;
}

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  setHover(el: Element | null): void;
  setSelected(el: Element | null, onCrumb: (el: Element) => void): void;
  /** Alça de arrastar do elemento selecionado. */
  onHandleDown(fn: (e: PointerEvent) => void): void;
  setDrop(el: Element | null, position?: 'before' | 'after' | 'append'): void;
  showMenu(x: number, y: number, items: MenuItem[]): void;
  hideMenu(): void;
  toast(text: string): void;
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
    <div class="handle" title="Arrastar para mover" aria-label="Arrastar para mover">⠿</div>
    <div class="drop"></div>
    <div class="crumbs" role="navigation" aria-label="Ancestrais"></div>
    <div class="menu" role="menu"></div>
    <div class="toast" role="status"></div>`;
  doc.documentElement.appendChild(host);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const hoverBox = $('.hover');
  const hoverLabel = $('.hover-label');
  const selBox = $('.sel');
  const selLabel = $('.sel-label');
  const handle = $('.handle');
  const drop = $('.drop');
  const crumbs = $('.crumbs');
  const menu = $('.menu');
  const toastEl = $('.toast');
  let hovered: Element | null = null;
  let selected: Element | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const px = (n: number) => `${n}px`;
  const place = (box: HTMLElement, label: HTMLElement, el: Element | null) => {
    if (!el || !el.isConnected) {
      box.style.display = label.style.display = 'none';
      return null;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: px(r.left),
      top: px(r.top),
      width: px(r.width),
      height: px(r.height),
    });
    label.textContent = labelOf(el);
    Object.assign(label.style, {
      display: 'block',
      left: px(Math.max(0, r.left)),
      top: px(r.top >= 20 ? r.top - 20 : r.bottom + 2),
    });
    return r;
  };

  const refresh = () => {
    place(hoverBox, hoverLabel, hovered && hovered !== selected ? hovered : null);
    const r = place(selBox, selLabel, selected);
    if (r) {
      const lr = selLabel.getBoundingClientRect();
      Object.assign(handle.style, { display: 'block', left: px(lr.right + 2), top: selLabel.style.top });
    } else handle.style.display = 'none';
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
    onHandleDown(fn) {
      handle.addEventListener('pointerdown', fn);
    },
    setDrop(el, position) {
      if (!el) {
        drop.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      drop.className = `drop ${position === 'append' ? 'inside' : 'line'}`;
      drop.dataset.position = position;
      Object.assign(drop.style, {
        display: 'block',
        left: px(r.left),
        width: px(r.width),
        top: px(position === 'after' ? r.bottom : r.top),
        height: px(position === 'append' ? r.height : 0),
      });
    },
    showMenu(x, y, items) {
      menu.replaceChildren(
        ...items.map((it) => {
          const b = doc.createElement('button');
          b.setAttribute('role', 'menuitem');
          b.dataset.action = it.id;
          b.textContent = it.label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            it.run();
          });
          return b;
        }),
      );
      const vw = doc.documentElement.clientWidth;
      const vh = doc.documentElement.clientHeight;
      Object.assign(menu.style, {
        display: 'flex',
        left: px(Math.min(x, vw - 200)),
        top: px(Math.min(y, vh - items.length * 30 - 10)),
      });
    },
    hideMenu() {
      menu.style.display = 'none';
    },
    toast(text) {
      toastEl.textContent = text;
      toastEl.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.style.display = 'none'), 1500);
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
