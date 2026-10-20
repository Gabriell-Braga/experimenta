// @vitest-environment jsdom
import { compileIntegrations, type TrackingEvent } from '@abtest/shared';
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
const batch = [
  { ...ctx, type: 'exposure' },
  { ...ctx, type: 'conversion', goalId: 'g', goalKey: 'compra', value: 10 },
  { ...ctx, type: 'exposure', qa: true },
  { ...ctx, type: 'pageview', device: 'desktop' },
] as unknown as TrackingEvent[];

type Fake = Record<string, unknown> & { dataLayer: unknown[] };

test('GA4 recebe experiment_impression; GTM recebe exposição e conversão; QA fica de fora', () => {
  const w = window as unknown as Fake;
  w.gtag = vi.fn();
  w.dataLayer = [];
  // Formato antigo das configs já publicadas também compila.
  integrationsAdapter(window, compileIntegrations({ ga4: true, gtm: true }))(batch);
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

test('Segment, Mixpanel e Amplitude: track(nome, props) no objeto do site; nomes personalizados e sem conversão', () => {
  const w = window as unknown as Record<string, { track: ReturnType<typeof vi.fn> } | undefined>;
  w.analytics = { track: vi.fn() };
  w.mixpanel = { track: vi.fn() };
  delete w.amplitude; // ferramenta ausente na página: ignorada sem erro
  const targets = compileIntegrations({
    segment: { enabled: true },
    mixpanel: { enabled: true, conversions: false },
    amplitude: { enabled: true, exposureEvent: 'Teste visto' },
  });
  integrationsAdapter(window, targets)(batch);
  expect(w.analytics!.track.mock.calls).toEqual([
    ['Experiment Viewed', { experiment_id: 'hero', variation_id: 'b' }],
    ['Experiment Converted', { experiment_id: 'hero', variation_id: 'b', goal: 'compra', value: 10 }],
  ]);
  expect(w.mixpanel!.track.mock.calls).toEqual([
    ['$experiment_started', { 'Experiment name': 'hero', 'Variant name': 'b' }],
  ]);
  w.amplitude = { track: vi.fn() };
  integrationsAdapter(window, targets)(batch.slice(0, 1));
  expect(w.amplitude.track).toHaveBeenCalledWith('Teste visto', { experiment_id: 'hero', variation_id: 'b' });
});
