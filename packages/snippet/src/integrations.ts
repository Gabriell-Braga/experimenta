// Integrações no navegador (GA4, GTM, Segment, Mixpanel, Amplitude): exposições e conversões vão para as
// ferramentas que o site já tem. Despacho genérico: nomes e formatos vêm da config (`compileIntegrations`).
import type { IntegrationTarget, TrackingEvent } from '@abtest/shared';
import type { Adapter } from './tracker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W = Record<string, any>;

export function integrationsAdapter(win: Window, targets: IntegrationTarget[]): Adapter {
  const w = win as unknown as W;
  return (events: TrackingEvent[]) => {
    for (const e of events)
      if (!e.qa && (e.type === 'exposure' || e.type === 'conversion'))
        for (const [o, exposure, conversion, x, v, g] of targets) {
          const name = e.type === 'exposure' ? exposure : conversion;
          if (!name) continue;
          const p: W = { [x]: e.experimentKey, [v]: e.variationKey };
          if (e.type === 'conversion') {
            p[g] = e.goalKey;
            p.value = e.value;
          }
          if (o === 'gtag') w.gtag?.('event', name, p);
          else if (o === 'dataLayer') (w.dataLayer ??= []).push({ event: name, ...p });
          else w[o]?.track?.(name, p);
        }
  };
}
