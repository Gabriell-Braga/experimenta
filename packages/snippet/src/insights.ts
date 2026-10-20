// Carregador do bundle sob demanda de insights (mapa de calor, frustração, formulários e gravação).
import type { Device, PublishedConfig, TrackingEvent } from '@abtest/shared';
import { murmurhash3 } from './bucket';
import { detectDevice } from './env';
import type { EventBase, Runtime } from './runtime';

/** Visitante amostrado? Determinístico por visitante (mesma decisão em todas as páginas). */
export const sampled = (visitorId: string, rate: number) =>
  murmurhash3(`${visitorId}:heatmap`) % 10000 < rate * 10000;

/** Contexto que o snippet entrega ao insights.js (window.__ABT_INSIGHTS__). */
export interface InsightsBoot {
  apiUrl: string;
  accountId: string;
  visitorId: string;
  sessionId: string;
  device: Device;
  heatmap: boolean;
  record: boolean;
  forms: boolean;
  send(e: TrackingEvent): void;
  /** Envia a fila agora (ao sair da página, depois de enfileirar). */
  flush(): void;
  base(): EventBase;
  /** Variações ativas na página (experimentId → variationId). */
  variations(): Record<string, string>;
  onNavigate: ((url: string) => void)[];
  /** Visitante recusou o consentimento: a gravação descarta o que tiver e para de enviar. */
  stopped?: boolean;
}

declare global {
  interface Window {
    __ABT_INSIGHTS__?: InsightsBoot;
  }
}

/** Contexto do insights.js a partir do runtime (snippet e testes). */
export function insightsBoot(
  win: Window,
  rt: Runtime,
  tracker: { send(e: TrackingEvent): void; flush(): void },
  config: PublishedConfig,
): InsightsBoot {
  const hm = config.heatmap;
  return {
    apiUrl: config.apiUrl ?? '',
    accountId: config.accountId,
    visitorId: rt.visitor.id,
    sessionId: rt.visitor.sessionId,
    device: detectDevice(win.navigator.userAgent, win.innerWidth),
    heatmap: true,
    // Gravação precisa da API (POST /rec).
    record: !!hm?.recordings && !!config.apiUrl,
    forms: !!hm?.forms,
    send: tracker.send,
    flush: tracker.flush,
    base: rt.base,
    variations: () =>
      Object.fromEntries([...rt.active.values()].map((a) => [a.experiment.id, a.variation.id])),
    onNavigate: rt.onNavigate,
  };
}
