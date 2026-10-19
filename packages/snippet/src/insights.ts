// Carregador do bundle sob demanda de insights (gravação de sessão e formulários).
import type { Device, TrackingEvent } from '@abtest/shared';
import type { EventBase } from './runtime';

/** Contexto que o snippet entrega ao insights.js (window.__ABT_INSIGHTS__). */
export interface InsightsBoot {
  apiUrl: string;
  accountId: string;
  visitorId: string;
  sessionId: string;
  device: Device;
  record: boolean;
  forms: boolean;
  send(e: TrackingEvent): void;
  /** Envia a fila agora (ao sair da página, depois de enfileirar). */
  flush(): void;
  base(): EventBase;
  /** Variações ativas na página (experimentId → variationId). */
  variations(): Record<string, string>;
  onNavigate: ((url: string) => void)[];
}

declare global {
  interface Window {
    __ABT_INSIGHTS__?: InsightsBoot;
  }
}

export function loadInsights(win: Window, src: string, boot: InsightsBoot): void {
  win.__ABT_INSIGHTS__ = boot;
  const s = win.document.createElement('script');
  s.src = src;
  s.async = true;
  (win.document.head ?? win.document.documentElement).appendChild(s);
}
