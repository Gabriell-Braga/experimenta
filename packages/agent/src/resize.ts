import type { OperationDraft, Target } from '@abtest/shared';

const CSS = `
.mr-frame{position:fixed;display:none;box-sizing:border-box;border:2px solid #f97316;pointer-events:auto;cursor:move;touch-action:none}
.mr-h{position:absolute;width:10px;height:10px;margin:-6px 0 0 -6px;background:#fff;border:2px solid #f97316;border-radius:2px}
.mr{position:fixed;top:12px;right:12px;display:none;width:300px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px #0003;font:13px/1.4 system-ui,sans-serif;color:#111827;pointer-events:auto}
.mr header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb}
.mr header button{all:unset;cursor:pointer;font-size:18px;line-height:1;padding:0 4px}
.mr .warn{margin:0;padding:8px 12px;background:#fef3c7;color:#92400e;font-size:12px}
.mr .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;padding:12px}
.mr .grid label{display:flex;align-items:center;justify-content:space-between;gap:6px}
.mr input[type=number]{width:80px;box-sizing:border-box;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font:inherit;text-align:right}
.mr .checks{display:flex;gap:16px;padding:0 12px 12px}
.mr .checks label{display:flex;align-items:center;gap:6px}
.mr footer{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;border-top:1px solid #e5e7eb}
.mr footer button{cursor:pointer;padding:5px 12px;border-radius:5px;border:1px solid #d1d5db;background:#fff;font:inherit}
.mr footer button[data-mr=done]{background:#16a34a;border-color:#16a34a;color:#fff}
`;

const HANDLES: Record<string, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};
const CURSOR: Record<string, string> = {
  n: 'ns',
  s: 'ns',
  e: 'ew',
  w: 'ew',
  nw: 'nwse',
  se: 'nwse',
  ne: 'nesw',
  sw: 'nesw',
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mover/redimensionar livre (como o Move/Resize da VWO): arrastar o quadro, puxar as alças ou digitar
 * X/Y (deslocamento a partir da posição original) e largura/altura. Pré-visualiza com estilo inline e,
 * em "Concluir", restaura o elemento e emite UM setStyle — o app reaplica a variação como sempre.
 */
export function createResize(
  win: Window,
  root: ShadowRoot,
  emit: (draft: OperationDraft) => void,
  targetOf: (el: Element) => Target,
) {
  const doc = win.document;
  const wrap = doc.createElement('div');
  wrap.innerHTML = `<style>${CSS}</style><div class="mr-frame" title="Arraste para mover">${Object.keys(
    HANDLES,
  )
    .map(
      (d) =>
        `<div class="mr-h" data-d="${d}" style="left:${HANDLES[d]![0] * 100}%;top:${HANDLES[d]![1] * 100}%;cursor:${CURSOR[d]}-resize"></div>`,
    )
    .join('')}</div>
    <div class="mr" role="dialog" aria-label="Mover / redimensionar">
      <header>Mover / redimensionar <button data-mr="close" aria-label="Fechar">×</button></header>
      <p class="warn">Mover elementos pode quebrar a responsividade do site. Confira a pré-visualização em todos os dispositivos antes de publicar.</p>
      <div class="grid">
        <label>X <input type="number" data-k="x" aria-label="X (px)"></label>
        <label>Largura <input type="number" data-k="w" min="1" aria-label="Largura (px)"></label>
        <label>Y <input type="number" data-k="y" aria-label="Y (px)"></label>
        <label>Altura <input type="number" data-k="h" min="1" aria-label="Altura (px)"></label>
      </div>
      <div class="checks">
        <label><input type="checkbox" data-mr="front"> Trazer para frente</label>
        <label><input type="checkbox" data-mr="ratio"> Manter proporção</label>
      </div>
      <footer><button data-mr="discard">Descartar</button><button data-mr="done">Concluir</button></footer>
    </div>`;
  root.append(...wrap.children);
  const frame = root.querySelector('.mr-frame') as HTMLElement;
  const panel = root.querySelector('.mr') as HTMLElement;
  const input = (k: keyof Box) => panel.querySelector(`[data-k="${k}"]`) as HTMLInputElement;
  const check = (k: string) => panel.querySelector(`[data-mr="${k}"]`) as HTMLInputElement;

  let s: {
    el: HTMLElement;
    style: string | null;
    position: string;
    borderBox: boolean;
    base: Box;
    cur: Box;
  } | null = null;
  let drag: { d: string; x: number; y: number; start: Box } | null = null;

  const px = (n: number) => `${Math.round(n)}px`;
  const num = (v: string) => parseFloat(v) || 0;

  const render = () => {
    if (!s) return;
    const { el, cur, base, position, borderBox } = s;
    const st = (p: string, v: string) => el.style.setProperty(p, v, 'important');
    if (position === 'static') st('position', 'relative');
    st('left', px(cur.x));
    st('top', px(cur.y));
    if (cur.w !== base.w || cur.h !== base.h) {
      if (!borderBox) st('box-sizing', 'border-box');
      st('width', px(cur.w));
      st('height', px(cur.h));
    }
    if (check('front').checked) st('z-index', '9999');
    else el.style.removeProperty('z-index');
    for (const k of ['x', 'y', 'w', 'h'] as const)
      if (doc.activeElement !== input(k) && root.activeElement !== input(k))
        input(k).value = String(Math.round(cur[k]));
    const r = el.getBoundingClientRect();
    Object.assign(frame.style, {
      display: 'block',
      left: px(r.left),
      top: px(r.top),
      width: px(r.width),
      height: px(r.height),
    });
  };

  const close = (commit: boolean) => {
    if (!s) return;
    const { el, style, base, cur, position, borderBox } = s;
    s = null;
    drag = null;
    frame.style.display = panel.style.display = 'none';
    // Volta ao original: a alteração chega pela variação reaplicada (fonte única da verdade).
    if (style === null) el.removeAttribute('style');
    else el.setAttribute('style', style);
    if (!commit) return;
    const value: Record<string, string> = {};
    const front = check('front').checked;
    if (cur.x !== base.x || cur.y !== base.y || front) {
      if (position === 'static') value.position = 'relative';
      if (cur.x !== base.x) value.left = px(cur.x);
      if (cur.y !== base.y) value.top = px(cur.y);
    }
    if (cur.w !== base.w || cur.h !== base.h) {
      if (!borderBox) value['box-sizing'] = 'border-box';
      value.width = px(cur.w);
      value.height = px(cur.h);
    }
    if (front) value['z-index'] = '9999';
    if (Object.keys(value).length) emit({ type: 'setStyle', target: targetOf(el), value });
  };

  const open = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    close(false);
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const base = { x: num(cs.left), y: num(cs.top), w: r.width, h: r.height };
    s = {
      el,
      style: el.getAttribute('style'),
      position: cs.position || 'static',
      borderBox: cs.boxSizing === 'border-box',
      base,
      cur: { ...base },
    };
    check('front').checked = num(cs.zIndex) >= 9999;
    check('ratio').checked = false;
    panel.style.display = 'block';
    for (const k of ['x', 'y', 'w', 'h'] as const) input(k).value = String(Math.round(base[k]));
    render();
  };

  /** Ajusta a outra dimensão para manter a proporção original. */
  const keepRatio = (b: Box, by: 'w' | 'h') => {
    if (!s || !check('ratio').checked || !s.base.w || !s.base.h) return;
    const ratio = s.base.w / s.base.h;
    if (by === 'w') b.h = b.w / ratio;
    else b.w = b.h * ratio;
  };

  panel.addEventListener('input', (e) => {
    const k = (e.target as HTMLElement).dataset.k as keyof Box | undefined;
    if (!s || !k) return render();
    const v = Number(input(k).value);
    if (!Number.isFinite(v)) return;
    s.cur[k] = k === 'w' || k === 'h' ? Math.max(1, v) : v;
    if (k === 'w' || k === 'h') {
      keepRatio(s.cur, k);
      input(k === 'w' ? 'h' : 'w').value = String(Math.round(s.cur[k === 'w' ? 'h' : 'w']));
    }
    render();
  });
  panel.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).dataset.mr) render();
  });
  panel.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.mr;
    if (a === 'done') close(true);
    else if (a === 'discard' || a === 'close') close(false);
  });

  frame.addEventListener('pointerdown', (e) => {
    if (!s) return;
    e.preventDefault();
    frame.setPointerCapture?.(e.pointerId);
    drag = {
      d: (e.target as HTMLElement).dataset.d ?? 'move',
      x: e.clientX,
      y: e.clientY,
      start: { ...s.cur },
    };
  });
  frame.addEventListener('pointermove', (e) => {
    if (!s || !drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const b = { ...drag.start };
    const d = drag.d;
    if (d === 'move') {
      b.x += dx;
      b.y += dy;
    } else {
      if (d.includes('e')) b.w += dx;
      if (d.includes('s')) b.h += dy;
      if (d.includes('w')) b.w -= dx;
      if (d.includes('n')) b.h -= dy;
      b.w = Math.max(1, b.w);
      b.h = Math.max(1, b.h);
      keepRatio(b, d === 'n' || d === 's' ? 'h' : 'w');
      // Alças de cima/esquerda puxam a borda oposta: desloca para a borda fixa não andar.
      if (d.includes('w')) b.x = drag.start.x + drag.start.w - b.w;
      if (d.includes('n')) b.y = drag.start.y + drag.start.h - b.h;
    }
    s.cur = b;
    render();
  });
  const endDrag = () => (drag = null);
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  const onScroll = () => render();
  win.addEventListener('scroll', onScroll, true);

  return {
    open,
    /** Escape descarta; true se a janela estava aberta. */
    cancel: () => (s ? (close(false), true) : false),
    isOpen: () => !!s,
    destroy() {
      close(false);
      win.removeEventListener('scroll', onScroll, true);
    },
  };
}
