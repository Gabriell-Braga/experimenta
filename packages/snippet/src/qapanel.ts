// Painel de Preview e QA (fase 21.7): log por página de cada experimento (regra de página bateu ou não, variação
// aplicada, alteração que não achou o elemento) e das metas que dispararam. Vai nos bundles sob demanda (qa.js e
// preview.js), nunca no runtime principal.
import type { TrackingEvent } from '@abtest/shared';
import type { Runtime } from './runtime';
import { matchSegmentation } from './segment';

export interface QaItem {
  /** ok = variação aplicada; page = regra de página não bateu; out = fora da audiência/tráfego; warn; goal. */
  k: 'ok' | 'page' | 'out' | 'warn' | 'goal';
  t: string;
}
export interface QaPage {
  url: string;
  ts: number;
  items: QaItem[];
}

const KEY = '_abt_qa_log';
const ICON: Record<QaItem['k'], string> = { ok: '✓', page: '✕', out: '–', warn: '⚠', goal: '◎' };
const COLOR: Record<QaItem['k'], string> = {
  ok: '#16a34a',
  page: '#dc2626',
  out: '#6b7280',
  warn: '#d97706',
  goal: '#2563eb',
};

/** Estado de cada experimento na página atual, como o runtime decidiu. */
export function pageItems(rt: Runtime): QaItem[] {
  const ctx = rt.ctx();
  return rt.config.experiments
    .filter((e) => e.status === 'running' && e.type !== 'server')
    .map((e): QaItem => {
      const a = rt.active.get(e.id);
      if (a) return { k: 'ok', t: `${e.name} → ${a.variation.name}` };
      if (!matchSegmentation(e.segmentation, ctx))
        return { k: 'page', t: `${e.name}: regra de página (URL) não bateu` };
      return { k: 'out', t: `${e.name}: fora da audiência ou do tráfego` };
    });
}

/** Evento do runtime → linha do log (só o que interessa ao QA). */
export function eventItem(e: TrackingEvent, rt: Runtime): QaItem | null {
  const name = (id: string) => rt.config.experiments.find((x) => x.id === id)?.name ?? id;
  if (e.type === 'conversion')
    return { k: 'goal', t: `Meta "${e.goalKey}" disparou em ${name(e.experimentId)}` };
  if (e.type === 'selector_failed')
    return { k: 'warn', t: `${name(e.experimentId)}: alteração não achou ${e.selector}` };
  return null;
}

function load(win: Window): QaPage[] {
  try {
    return JSON.parse(win.sessionStorage.getItem(KEY) || '[]') as QaPage[];
  } catch {
    return [];
  }
}
function save(win: Window, log: QaPage[]) {
  try {
    win.sessionStorage.setItem(KEY, JSON.stringify(log.slice(-20)));
  } catch {
    /* sem sessionStorage: log só desta página */
  }
}

/**
 * Painel fixo (Shadow DOM) com o log das páginas desta sessão, a mais recente no topo. Ouve `abt:event` (o
 * tracker do snippet, ou o sink do preview) para metas e seletores que falharam.
 */
export function qaPanel(
  win: Window,
  rt: Runtime | null,
  title: string,
): { host: HTMLElement; refresh(): void } {
  const doc = win.document;
  const log = load(win);
  let cur: QaPage = { url: win.location.href, ts: Date.now(), items: [] };
  log.push(cur);
  const host = doc.createElement('div');
  host.setAttribute('data-abt-qa', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647}
.p{width:320px;max-height:60vh;display:flex;flex-direction:column;font:12px/1.4 system-ui,sans-serif;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px #0003;overflow:hidden}
header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#111827;color:#fff;font-weight:600}
header span{flex:1}
button{all:unset;cursor:pointer;opacity:.8;padding:0 4px}
.l{overflow:auto}
.u{padding:6px 10px 2px;font:11px ui-monospace,monospace;color:#6b7280;word-break:break-all}
.i{display:flex;gap:6px;padding:2px 10px}
.i b{width:12px;flex:none;text-align:center}
.min .l{display:none}
</style><div class="p" role="log" aria-label="${title.replace(/[<&"]/g, '')}"><header><span></span><button data-a="clear" aria-label="Limpar log">⟲</button><button data-a="min" aria-label="Minimizar">—</button><button data-a="close" aria-label="Fechar">✕</button></header><div class="l"></div></div>`;
  root.querySelector('header span')!.textContent = title;
  const list = root.querySelector('.l') as HTMLElement;
  const panel = root.querySelector('.p') as HTMLElement;

  const render = () => {
    save(win, log);
    list.replaceChildren(
      ...[...log].reverse().flatMap((pg) => {
        let path = pg.url;
        try {
          const u = new URL(pg.url);
          path = u.pathname + u.search;
        } catch {
          /* URL inválida: mostra como veio */
        }
        const u = doc.createElement('div');
        u.className = 'u';
        u.textContent = `${new Date(pg.ts).toLocaleTimeString()} · ${path}`;
        return [
          u,
          ...(pg.items.length ? pg.items : [{ k: 'out', t: 'Nenhum experimento publicado' } as QaItem]).map(
            (it) => {
              const row = doc.createElement('div');
              row.className = 'i';
              row.dataset.k = it.k;
              const b = doc.createElement('b');
              b.textContent = ICON[it.k];
              b.style.color = COLOR[it.k];
              const s = doc.createElement('span');
              s.textContent = it.t;
              row.append(b, s);
              return row;
            },
          ),
        ];
      }),
    );
  };
  const refresh = () => {
    const extra = cur.items.filter((i) => i.k === 'goal' || i.k === 'warn');
    cur.items = [...(rt ? pageItems(rt) : []), ...extra];
    render();
  };
  win.addEventListener('abt:event', (ev) => {
    const it = rt && eventItem((ev as CustomEvent<TrackingEvent>).detail, rt);
    if (it) {
      cur.items.push(it);
      render();
    }
  });
  rt?.onNavigate.push((url) => {
    // SPA: nova página no log.
    log.push((cur = { url, ts: Date.now(), items: [] }));
    refresh();
  });
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'close') host.remove();
    else if (a === 'min') panel.classList.toggle('min');
    else if (a === 'clear') {
      log.splice(0, log.length, cur);
      render();
    }
  });
  refresh();
  const mount = () => doc.body.appendChild(host);
  if (doc.body) mount();
  else doc.addEventListener('DOMContentLoaded', mount, { once: true });
  return { host, refresh };
}
