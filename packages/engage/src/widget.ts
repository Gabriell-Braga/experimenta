import type { Popup } from '@abtest/shared';

/** Estilos isolados no Shadow DOM (o CSS do site não vaza para dentro nem para fora). */
const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.backdrop{position:fixed;inset:0;background:rgba(15,16,20,.48);display:grid;place-items:center;z-index:2147483646;animation:fade .18s ease-out}
.card{position:relative;width:min(440px,calc(100vw - 32px));border-radius:14px;padding:26px 24px 22px;box-shadow:0 24px 60px -18px rgba(0,0,0,.45);animation:rise .22s ease-out}
.slide{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:min(360px,calc(100vw - 32px))}
.bar{position:fixed;left:0;right:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;padding:10px 48px 10px 16px;font-size:14px;animation:fade .18s ease-out}
.bar.top{top:0}.bar.bottom{bottom:0}
.light{background:#fff;color:#16181d}.dark{background:#16181d;color:#f4f1ea}.brand{color:#fff}
.img{display:block;width:100%;max-height:180px;object-fit:cover;border-radius:10px;margin:-6px 0 14px}
h2{margin:0 0 6px;font-size:20px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.bar h2{font-size:14px;margin:0}
p{margin:0;font-size:14.5px;line-height:1.5;opacity:.85}
.bar p{font-size:14px}
.row{display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap}
.bar .row{margin:0}
.cta{appearance:none;border:0;border-radius:9px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
.code{font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;padding:9px 12px;border:1.5px dashed currentColor;border-radius:9px;cursor:pointer;background:transparent;color:inherit}
.x{position:absolute;top:8px;right:8px;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.6;cursor:pointer;font-size:20px;line-height:1}
.x:hover{opacity:1}
.bar .x{top:50%;transform:translateY(-50%)}
@keyframes fade{from{opacity:0}}@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.98)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

const contrast = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#16181d' : '#ffffff';
};

export interface WidgetHandlers {
  onCta?(): void;
  onClose?(): void;
}

/**
 * Monta o pop-up/barra num host com Shadow DOM e devolve o host (para inserir) e `remove`.
 * Textos entram por `textContent` (nunca HTML); usado pelo engage.js e pela pré-visualização do app.
 */
export function renderPopup(
  doc: Document,
  p: Pick<Popup, 'format' | 'title' | 'body' | 'image' | 'cta' | 'code' | 'theme' | 'accent'>,
  h: WidgetHandlers = {},
) {
  const host = doc.createElement('abt-engage');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const el = (tag: string, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const bar = p.format === 'bar-top' || p.format === 'bar-bottom';
  const box = el(
    'div',
    `${bar ? `bar ${p.format === 'bar-top' ? 'top' : 'bottom'}` : p.format === 'slide-in' ? 'card slide' : 'card'} ${p.theme}`,
  );
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', p.title || 'Aviso');
  if (p.format === 'modal') box.setAttribute('aria-modal', 'true');
  if (p.theme === 'brand') box.style.background = p.accent;
  if (p.image && !bar) {
    const img = el('img', 'img') as HTMLImageElement;
    img.src = p.image;
    img.alt = '';
    box.append(img);
  }
  if (p.title) box.append(el('h2', '', p.title));
  if (p.body) box.append(el('p', '', p.body));
  const row = el('div', 'row');
  if (p.code) {
    const code = el('button', 'code', p.code);
    code.setAttribute('aria-label', `Copiar código ${p.code}`);
    code.addEventListener('click', () => {
      doc.defaultView?.navigator.clipboard?.writeText(p.code!).catch(() => {});
      code.textContent = 'Copiado!';
    });
    row.append(code);
  }
  if (p.cta) {
    const cta = el(p.cta.url ? 'a' : 'button', 'cta', p.cta.label);
    if (p.cta.url && /^(https?:|\/|#)/.test(p.cta.url)) (cta as HTMLAnchorElement).href = p.cta.url;
    const bg = p.theme === 'brand' ? contrast(p.accent) : p.accent;
    cta.style.background = bg;
    cta.style.color = contrast(bg);
    cta.addEventListener('click', () => h.onCta?.());
    row.append(cta);
  }
  if (row.childNodes.length) box.append(row);
  const x = el('button', 'x', '×');
  x.setAttribute('aria-label', 'Fechar');
  const close = () => {
    remove();
    h.onClose?.();
  };
  x.addEventListener('click', close);
  box.append(x);
  let wrap: HTMLElement = box;
  if (p.format === 'modal') {
    wrap = el('div', 'backdrop');
    wrap.append(box);
    wrap.addEventListener('click', (e) => e.target === wrap && close());
  }
  root.append(style, wrap);
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  doc.addEventListener('keydown', onKey);
  const remove = () => {
    doc.removeEventListener('keydown', onKey);
    host.remove();
  };
  return { host, remove, focus: () => (p.cta ? (row.lastElementChild as HTMLElement | null) : x)?.focus() };
}
