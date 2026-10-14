import type { TrackingEvent } from '@abtest/shared';

/** Recebe lotes de eventos. Adaptadores extras podem enviar para GA, Segment, analytics próprio etc. */
export type Adapter = (events: TrackingEvent[]) => void;

export interface Tracker {
  send(e: TrackingEvent): void;
  addAdapter(a: Adapter): void;
  flush(): void;
}

/** Envio padrão: POST text/plain via sendBeacon (sem preflight CORS), com fallback para fetch keepalive. */
export function beaconAdapter(win: Window, url: string): Adapter {
  return (events) => {
    const body = JSON.stringify({ events });
    const nav = win.navigator;
    if (nav.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
    win
      .fetch?.(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } })
      .catch(() => {});
  };
}

/**
 * Fila com envio em lote (a cada `intervalMs`, ao esconder/sair da página ou imediatamente numa conversão).
 * Todo evento também vira `CustomEvent('abt:event')` no window, para integrações sem código.
 */
export function createTracker(win: Window, url?: string, intervalMs = 1000): Tracker {
  const adapters: Adapter[] = url ? [beaconAdapter(win, url)] : [];
  let queue: TrackingEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    for (const a of adapters) {
      try {
        a(batch);
      } catch {
        /* adaptador de terceiro não pode derrubar o snippet */
      }
    }
  };

  win.addEventListener('pagehide', flush);
  win.document.addEventListener(
    'visibilitychange',
    () => win.document.visibilityState === 'hidden' && flush(),
  );

  return {
    send(e) {
      queue.push(e);
      win.dispatchEvent(new CustomEvent('abt:event', { detail: e }));
      // Conversão costuma preceder uma navegação (clique em link, submit): envia já.
      if (e.type === 'conversion') flush();
      else timer ??= setTimeout(flush, intervalMs);
    },
    addAdapter: (a) => adapters.push(a),
    flush,
  };
}
