// Carregador do bundle sob demanda de engajamento (pop-ups, barras, pesquisas).
import type { PublishedConfig, TrackingEvent } from '@abtest/shared';
import type { AudienceContext } from './audience';
import type { EventBase, Runtime } from './runtime';

/** Contexto que o snippet entrega ao engage.js (window.__ABT_ENGAGE__). */
export interface EngageBoot {
  config: PublishedConfig;
  /** Pasta da CDN da conta (modelo de recomendações `<conta>.reco.json`). */
  cdnBase: string;
  send(e: TrackingEvent): void;
  flush(): void;
  base(): EventBase;
  /** Contexto atual para avaliar audiências e segmentação. */
  ctx(): AudienceContext;
  onNavigate: ((url: string) => void)[];
}

declare global {
  interface Window {
    __ABT_ENGAGE__?: EngageBoot;
  }
}

export function engageBoot(
  win: Window,
  rt: Runtime,
  tracker: { send(e: TrackingEvent): void; flush(): void },
  cdnBase = '',
): EngageBoot {
  return {
    config: rt.config,
    cdnBase,
    send: tracker.send,
    flush: tracker.flush,
    base: rt.base,
    ctx: rt.ctx,
    onNavigate: rt.onNavigate,
  };
}

/** Carrega um bundle irmão do snippet (mesma pasta) com o contexto em `window[key]`. */
export function loadBundle(
  win: Window,
  src: string,
  key: '__ABT_ENGAGE__' | '__ABT_INSIGHTS__',
  boot: object,
): void {
  (win as unknown as Record<string, unknown>)[key] = boot;
  const s = win.document.createElement('script');
  s.src = src;
  s.async = true;
  (win.document.head ?? win.document.documentElement).appendChild(s);
}
