import { record } from '@rrweb/record';
import type { InsightsBoot } from '@abtest/snippet/insights';

type RrEvent = { timestamp: number; type: number; data?: unknown };

/** Corpo máximo de um POST /rec (a API recusa acima de 1 MB). */
const MAX_BODY = 900_000;
/** `keepalive` (envio ao sair da página) só aceita corpos pequenos. */
const KEEPALIVE_MAX = 60_000;

export interface RecorderOptions {
  flushMs?: number;
  /** Bytes acumulados que disparam envio antes do intervalo. */
  maxBytes?: number;
  fetch?: typeof fetch;
  /** Injetável nos testes (o rrweb real precisa de um DOM completo). */
  record?: (opts: { emit(e: RrEvent): void }) => (() => void) | undefined;
}

/**
 * Grava a sessão com rrweb e envia em blocos para `${apiUrl}/rec`. Privacidade por padrão: todos os campos
 * mascarados; `.abt-block` some da gravação e `.abt-mask` tem o texto trocado por asteriscos.
 */
export function startRecorder(win: Window, boot: InsightsBoot, o: RecorderOptions = {}) {
  const post = o.fetch ?? win.fetch.bind(win);
  const url = `${boot.apiUrl}/rec`;
  let buf: RrEvent[] = [];
  let bytes = 0;

  const send = (events: RrEvent[], keepalive: boolean) => {
    const body = JSON.stringify({
      accountId: boot.accountId,
      sessionId: boot.sessionId,
      visitorId: boot.visitorId,
      device: boot.device,
      vw: win.innerWidth,
      vh: win.innerHeight,
      events,
    });
    // Bloco grande (snapshot completo de página pesada): divide ao meio até caber.
    if (body.length > MAX_BODY && events.length > 1) {
      const mid = Math.ceil(events.length / 2);
      send(events.slice(0, mid), keepalive);
      send(events.slice(mid), keepalive);
      return;
    }
    if (body.length > MAX_BODY) return; // um único evento gigante: descartado
    post(url, {
      method: 'POST',
      body,
      keepalive: keepalive && body.length < KEEPALIVE_MAX,
      headers: { 'content-type': 'text/plain' },
    }).catch(() => {});
  };
  const flush = (keepalive = false) => {
    if (!buf.length) return;
    const events = buf;
    buf = [];
    bytes = 0;
    if (!boot.stopped) send(events, keepalive);
  };

  const rec =
    o.record ??
    ((opts) =>
      record({
        ...opts,
        maskAllInputs: true,
        blockClass: 'abt-block',
        maskTextClass: 'abt-mask',
        sampling: { mousemove: 50, scroll: 150, input: 'last', media: 800 },
        inlineStylesheet: true,
        recordCanvas: false,
        collectFonts: false,
      }) as (() => void) | undefined);
  const stop = rec({
    emit(e) {
      buf.push(e);
      // ponytail: tamanho estimado pelo JSON de cada evento; o snapshot completo é o único caro.
      bytes += e.type === 2 ? MAX_BODY : JSON.stringify(e.data ?? '').length;
      if (bytes >= (o.maxBytes ?? 200_000)) flush();
    },
  });
  const timer = setInterval(() => flush(), o.flushMs ?? 5000);
  const onHide = () => flush(true);
  win.addEventListener('pagehide', onHide);
  const onVisibility = () => win.document.visibilityState === 'hidden' && flush(true);
  win.document.addEventListener('visibilitychange', onVisibility);
  return {
    flush,
    stop() {
      stop?.();
      clearInterval(timer);
      win.removeEventListener('pagehide', onHide);
      win.document.removeEventListener('visibilitychange', onVisibility);
      flush();
    },
  };
}
