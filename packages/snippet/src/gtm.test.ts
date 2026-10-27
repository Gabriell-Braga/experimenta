// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { watchDataLayer } from './gtm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any;
beforeEach(() => delete w.dataLayer);

test('eventos do dataLayer (já enfileirados e novos) viram eventos; gtm.* e os nossos ficam de fora', () => {
  w.dataLayer = [{ event: 'gtm.js' }, { event: 'lead', plano: 'pro', valor: 10, obj: { x: 1 } }];
  const track = vi.fn();
  watchDataLayer(window, { events: true }, ['abt_exposure'], track, vi.fn(), () => undefined);
  w.dataLayer.push(
    { event: 'abt_exposure', abt_experiment: 'x' },
    { event: 'add_to_cart', 'gtm.uniqueEventId': 3 },
  );
  expect(track.mock.calls).toEqual([
    ['lead', { plano: 'pro', valor: 10 }],
    ['add_to_cart', {}],
  ]);
  expect(w.dataLayer).toHaveLength(4); // o push original continua
});

test('user_id do site (objeto ou gtag config/set) vira identify uma vez; desligado não lê', () => {
  let known: string | undefined;
  const identify = vi.fn((id: string) => (known = id));
  const track = vi.fn();
  watchDataLayer(window, { userId: true }, [], track, identify, () => known);
  function gtag(..._a: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  }
  gtag('config', 'G-1', { user_id: 42 });
  w.dataLayer.push({ event: 'login', user_id: '42' });
  w.dataLayer.push({ userId: 'u-9' });
  expect(identify.mock.calls).toEqual([['42'], ['u-9']]);
  expect(track).not.toHaveBeenCalled();
});
