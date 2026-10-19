// @vitest-environment jsdom
import type { TrackingEvent } from '@abtest/shared';
import { expect, test, vi } from 'vitest';
import { integrationsAdapter } from './integrations';

const ctx = {
  eventId: 'e',
  ts: 1,
  accountId: 'a',
  visitorId: 'v',
  url: '',
  experimentId: 'x',
  experimentKey: 'hero',
  variationId: 'vb',
  variationKey: 'b',
};

test('GA4 recebe experiment_impression; GTM recebe exposição e conversão; QA fica de fora', () => {
  const w = window as unknown as { gtag: ReturnType<typeof vi.fn>; dataLayer: unknown[] };
  w.gtag = vi.fn();
  w.dataLayer = [];
  integrationsAdapter(window, { ga4: true, gtm: true })([
    { ...ctx, type: 'exposure' },
    { ...ctx, type: 'conversion', goalId: 'g', goalKey: 'compra', value: 10 },
    { ...ctx, type: 'exposure', qa: true },
    { ...ctx, type: 'pageview', device: 'desktop' } as unknown as TrackingEvent,
  ] as TrackingEvent[]);
  expect(w.gtag).toHaveBeenCalledTimes(1);
  expect(w.gtag).toHaveBeenCalledWith('event', 'experiment_impression', {
    experiment_id: 'hero',
    variant_id: 'b',
  });
  expect(w.dataLayer).toEqual([
    { event: 'abt_exposure', abt_experiment: 'hero', abt_variation: 'b' },
    { event: 'abt_conversion', abt_experiment: 'hero', abt_variation: 'b', abt_goal: 'compra', value: 10 },
  ]);
});
