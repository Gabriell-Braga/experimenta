// Captura para mapa de calor/cliques e profundidade de scroll. Entra no bundle do site: manter enxuto.
import { pathOf } from '@abtest/selector/resolve';
import type { HeatmapEvent } from '@abtest/shared';
import { murmurhash3 } from './bucket';
import { detectDevice, randomId } from './env';
import type { Runtime } from './runtime';

/** Distribui o Omit sobre a união. */
type Payload = HeatmapEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'eventId' | 'ts' | 'accountId' | 'visitorId' | 'url' | 'device' | 'variations'>
    : never
  : never;

/** Visitante amostrado? Determinístico por visitante (mesma decisão em todas as páginas). */
export const sampled = (visitorId: string, rate: number) =>
  murmurhash3(`${visitorId}:heatmap`) % 10000 < rate * 10000;

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function installHeatmap(
  win: Window,
  rt: Runtime,
  tracker: { send(e: HeatmapEvent): void; flush(): void },
  sampleRate: number,
): boolean {
  if (!sampled(rt.visitor.id, sampleRate)) return false;
  const doc = win.document;
  let url = win.location.href;
  let maxDepth = 0;

  const send = (p: Payload) =>
    tracker.send({
      ...p,
      eventId: randomId(),
      ts: Date.now(),
      accountId: rt.config.accountId,
      visitorId: rt.visitor.id,
      sessionId: rt.visitor.sessionId,
      url,
      device: detectDevice(win.navigator.userAgent, win.innerWidth),
      variations: Object.fromEntries([...rt.active.values()].map((a) => [a.experiment.id, a.variation.id])),
    } as HeatmapEvent);

  // Frustração: rajada de cliques perto do mesmo ponto (rage) e clique sem reação (dead).
  let burst: { x: number; y: number; t: number; n: number; sent: boolean } | null = null;
  let changed = 0; // mutações/navegação/foco desde o último clique
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => changed++) : null;
  mo?.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true });
  const bump = () => changed++;
  win.addEventListener('pagehide', bump);
  win.addEventListener('hashchange', bump);
  doc.addEventListener('focusin', bump);
  rt.onNavigate.push(bump);

  doc.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || el.closest('[data-abt-qa]')) return;
      const r = el.getBoundingClientRect();
      const selector = pathOf(el).slice(0, 500);
      const rx = round(r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5);
      const ry = round(r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0.5);
      send({
        type: 'click',
        selector,
        rx,
        ry,
        px: Math.round(e.pageX),
        py: Math.round(e.pageY),
        vw: win.innerWidth,
        vh: win.innerHeight,
      });
      const now = Date.now();
      if (burst && now - burst.t < 700 && Math.hypot(e.clientX - burst.x, e.clientY - burst.y) < 30) {
        burst.n++;
        burst.t = now;
        if (burst.n === 3 && !burst.sent) {
          burst.sent = true;
          send({ type: 'frustration', kind: 'rage', selector, rx, ry, count: 3 });
        }
      } else burst = { x: e.clientX, y: e.clientY, t: now, n: 1, sent: false };
      // Campos de formulário e seleção de texto reagem sem mexer no DOM: não contam como dead click.
      if (el.closest('input,textarea,select,label,[contenteditable]') || String(win.getSelection?.() ?? ''))
        return;
      const before = changed;
      setTimeout(() => {
        if (changed === before && burst?.n === 1)
          send({ type: 'frustration', kind: 'dead', selector, rx, ry, count: 1 });
      }, 1000);
    },
    { capture: true, passive: true },
  );

  // Movimento do mouse: um ponto a cada 150 ms em movimento, enviados em lotes de 50.
  let moves: [number, number][] = [];
  let lastMove = 0;
  const flushMoves = () => {
    if (moves.length) send({ type: 'move', points: moves, vw: win.innerWidth });
    moves = [];
  };
  doc.addEventListener(
    'mousemove',
    (e) => {
      const now = Date.now();
      if (now - lastMove < 150) return;
      lastMove = now;
      moves.push([round(e.clientX / (win.innerWidth || 1)), Math.round(e.pageY)]);
      if (moves.length >= 50) flushMoves();
    },
    { passive: true },
  );

  const measure = () => {
    const ph = doc.documentElement.scrollHeight;
    maxDepth = Math.max(maxDepth, ph ? Math.min(100, ((win.scrollY + win.innerHeight) / ph) * 100) : 100);
  };
  // A primeira dobra conta como vista mesmo sem rolar.
  if (doc.readyState === 'complete') measure();
  else win.addEventListener('load', measure, { once: true });
  let raf = 0;
  win.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    },
    { passive: true },
  );

  /** Um evento de scroll por página vista (ao sair ou ao navegar na SPA). */
  const flushScroll = () => {
    flushMoves();
    measure();
    send({
      type: 'scroll',
      depth: Math.round(maxDepth),
      vh: win.innerHeight,
      ph: doc.documentElement.scrollHeight,
    });
    tracker.flush();
    maxDepth = 0;
  };
  win.addEventListener('pagehide', flushScroll);
  rt.onNavigate.push((next) => {
    flushScroll();
    url = next;
  });
  return true;
}
