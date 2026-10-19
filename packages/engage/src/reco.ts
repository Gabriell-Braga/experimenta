import type { RecoWidget, TrackingEvent } from '@abtest/shared';
import { recommend, type RecoModel } from '@abtest/shared/reco';
import type { EngageBoot } from '@abtest/snippet/engage';
import { eligible } from './campaigns';

const CSS = `
:host{all:initial;display:block}
*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
section{margin:24px 0;color:#16181d}
h2{font-size:18px;font-weight:700;margin:0 0 12px;letter-spacing:-.01em}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
a{display:block;text-decoration:none;color:inherit;border:1px solid #e6e2d9;border-radius:12px;overflow:hidden;background:#fff;transition:transform .15s,box-shadow .15s;cursor:pointer}
a:hover{transform:translateY(-2px);box-shadow:0 10px 24px -14px rgba(0,0,0,.35)}
.img{aspect-ratio:4/3;background:#f2efe8;display:grid;place-items:center;font-size:30px;font-weight:700;color:#fff}
.img img{width:100%;height:100%;object-fit:cover}
.b{padding:10px 12px 12px}
.n{font-size:13.5px;font-weight:600;line-height:1.3;margin:0 0 4px}
.p{font-size:13px;opacity:.75;margin:0}
@media (prefers-reduced-motion:reduce){a{transition:none}}
`;
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const safeUrl = (u?: string) => (u && /^(https?:|\/)/.test(u) ? u : undefined);

export interface ShelfItem {
  id: string;
  name: string;
  price?: number;
  url?: string;
  image?: string;
}

/** Monta a vitrine (Shadow DOM, textos por textContent). */
export function renderShelf(
  doc: Document,
  w: Pick<RecoWidget, 'title' | 'accent'>,
  items: ShelfItem[],
  onClick: (id: string) => void,
) {
  const host = doc.createElement('abt-reco');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const sec = doc.createElement('section');
  sec.setAttribute('aria-label', w.title);
  const h = doc.createElement('h2');
  h.textContent = w.title;
  const row = doc.createElement('div');
  row.className = 'row';
  for (const it of items) {
    const a = doc.createElement('a');
    const url = safeUrl(it.url);
    if (url) a.href = url;
    a.dataset.product = it.id;
    const img = doc.createElement('div');
    img.className = 'img';
    const src = safeUrl(it.image);
    if (src) {
      const i = doc.createElement('img');
      i.src = src;
      i.alt = '';
      i.loading = 'lazy';
      img.append(i);
    } else {
      img.style.background = w.accent;
      img.textContent = it.name.slice(0, 1).toUpperCase();
    }
    const b = doc.createElement('div');
    b.className = 'b';
    const n = doc.createElement('p');
    n.className = 'n';
    n.textContent = it.name;
    b.append(n);
    if (it.price !== undefined) {
      const p = doc.createElement('p');
      p.className = 'p';
      p.textContent = brl(it.price);
      b.append(p);
    }
    a.append(img, b);
    a.addEventListener('click', () => onClick(it.id));
    row.append(a);
  }
  sec.append(h, row);
  root.append(style, sec);
  return host;
}

/** Espera o elemento de referência aparecer (sites que montam o conteúdo depois do load). */
function waitFor(doc: Document, selector: string, timeoutMs = 5000): Promise<Element | null> {
  const find = () => {
    try {
      return doc.querySelector(selector);
    } catch {
      return null;
    }
  };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const el = find();
      if (el) {
        mo.disconnect();
        resolve(el);
      }
    });
    mo.observe(doc.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      mo.disconnect();
      resolve(find());
    }, timeoutMs);
  });
}

/**
 * Vitrines de recomendação: baixa o modelo pré-calculado da CDN uma vez e insere cada vitrine elegível no
 * ponto configurado; produto de referência = último produto visto pelo visitante.
 */
export function startRecos(win: Window, boot: EngageBoot, fetchModel?: () => Promise<RecoModel | null>) {
  const widgets = boot.config.recos ?? [];
  if (!widgets.length) return;
  const load =
    fetchModel ??
    (() =>
      win
        .fetch(`${boot.cdnBase}${boot.config.accountId}.reco.json`)
        .then((r) => (r.ok ? (r.json() as Promise<RecoModel>) : null))
        .catch(() => null));
  let model: Promise<RecoModel | null> | null = null;
  const mounted: Element[] = [];
  const send = (id: string, action: 'view' | 'click') =>
    boot.send({ ...boot.base(), type: 'engage', campaignId: id, kind: 'reco', action } as TrackingEvent);
  const run = async () => {
    mounted.splice(0).forEach((m) => m.remove());
    for (const w of widgets) {
      const asCampaign = { ...w, frequency: 'always', trigger: { type: 'load' } } as never;
      if (!eligible(asCampaign, boot, { local: 0, session: 0 })) continue;
      const m = await (model ??= load());
      if (!m) return;
      const viewed = boot.ctx().profile.r ?? [];
      const ids = recommend(m, w.strategy, { product: viewed.at(-1), viewed, limit: w.limit });
      if (!ids.length) continue;
      const anchor = await waitFor(win.document, w.selector);
      if (!anchor) continue;
      const host = renderShelf(
        win.document,
        w,
        ids.map((id) => ({ id, ...m.catalog[id]! })),
        () => {
          send(w.id, 'click');
          boot.flush();
        },
      );
      if (w.position === 'before') anchor.before(host);
      else if (w.position === 'after') anchor.after(host);
      else if (w.position === 'prepend') anchor.prepend(host);
      else anchor.append(host);
      mounted.push(host);
      send(w.id, 'view');
    }
  };
  void run();
  boot.onNavigate.push(() => void run());
}
