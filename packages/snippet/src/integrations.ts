// GA4 e Google Tag Manager no navegador: as exposições (e conversões, no GTM) vão para as ferramentas do site.
import type { Integrations, TrackingEvent } from '@abtest/shared';
import type { Adapter } from './tracker';

type W = Window & { gtag?: (...a: unknown[]) => void; dataLayer?: unknown[] };

export function integrationsAdapter(win: Window, ig: Integrations): Adapter {
  const w = win as W;
  return (events: TrackingEvent[]) => {
    for (const e of events) {
      if (e.qa || (e.type !== 'exposure' && e.type !== 'conversion')) continue;
      const ctx = { abt_experiment: e.experimentKey, abt_variation: e.variationKey };
      if (e.type === 'exposure') {
        // Evento recomendado do GA4 para testes A/B.
        if (ig.ga4)
          w.gtag?.('event', 'experiment_impression', {
            experiment_id: e.experimentKey,
            variant_id: e.variationKey,
          });
        if (ig.gtm) (w.dataLayer ??= []).push({ event: 'abt_exposure', ...ctx });
      } else if (ig.gtm)
        (w.dataLayer ??= []).push({ event: 'abt_conversion', ...ctx, abt_goal: e.goalKey, value: e.value });
    }
  };
}
