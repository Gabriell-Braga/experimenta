const FORCE_KEY = '_abt_force';

/**
 * Modo QA: `?ab_force=experimento:variacao[,exp2:var2]` força variações (ignora segmentação e tráfego).
 * Fica salvo na sessão para sobreviver à navegação; `?ab_force=off` limpa.
 */
export function readForce(win: Window): Record<string, string> | undefined {
  let raw = new URLSearchParams(win.location.search).get('ab_force');
  try {
    if (raw === 'off' || raw === '') win.sessionStorage.removeItem(FORCE_KEY);
    else if (raw) win.sessionStorage.setItem(FORCE_KEY, raw);
    else raw = win.sessionStorage.getItem(FORCE_KEY);
  } catch {
    /* sem sessionStorage: vale só para esta página */
  }
  if (!raw || raw === 'off') return undefined;
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [exp, variation] = pair.split(':');
    if (exp && variation) out[exp.trim()] = variation.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** Selo fixo (em Shadow DOM, imune ao CSS do site) mostrando as variações forçadas. */
export function showBadge(doc: Document, active: { experiment: string; variation: string }[]): HTMLElement {
  const host = doc.createElement('div');
  host.setAttribute('data-abt-qa', '');
  const root = host.attachShadow({ mode: 'open' });
  const lines = active.length
    ? active.map((a) => `<div><b>${esc(a.experiment)}</b> → ${esc(a.variation)}</div>`).join('')
    : '<div>nenhum experimento ativo nesta página</div>';
  root.innerHTML = `<style>
:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647}
.b{font:12px/1.4 system-ui,sans-serif;background:#111827;color:#fff;padding:8px 10px;border-radius:8px;box-shadow:0 4px 12px #0004}
button{all:unset;cursor:pointer;float:right;margin-left:8px;opacity:.7}
</style><div class="b" role="status"><button aria-label="Fechar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button><div>Modo QA A/B</div>${lines}</div>`;
  root.querySelector('button')!.addEventListener('click', () => host.remove());
  const mount = () => doc.body.appendChild(host);
  if (doc.body) mount();
  else doc.addEventListener('DOMContentLoaded', mount, { once: true });
  return host;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
