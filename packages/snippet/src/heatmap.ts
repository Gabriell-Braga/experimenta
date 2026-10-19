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

  doc.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || el.closest('[data-abt-qa]')) return;
      const r = el.getBoundingClientRect();
      send({
        type: 'click',
        selector: pathOf(el).slice(0, 500),
        rx: round(r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5),
        ry: round(r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0.5),
        px: Math.round(e.pageX),
        py: Math.round(e.pageY),
        vw: win.innerWidth,
        vh: win.innerHeight,
      });
    },
    { capture: true, passive: true },
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
