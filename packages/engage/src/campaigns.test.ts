// @vitest-environment jsdom
import { PopupSchema, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import type { EngageBoot } from '@abtest/snippet/engage';
import { beforeEach, expect, test, vi } from 'vitest';
import { startEngage } from './campaigns';

let sent: TrackingEvent[];
const popup = (o: object) => ({
  id: 'p1',
  name: 'Cupom',
  ...PopupSchema.parse({ status: 'running', title: 'Ganhe 10%', body: 'Só hoje', ...o }),
});

function boot(
  popups: ReturnType<typeof popup>[],
  ctx: Partial<ReturnType<EngageBoot['ctx']>> = {},
): EngageBoot {
  const config: PublishedConfig = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    experiments: [],
    popups,
    audiences: [],
  };
  return {
    config,
    send: (e) => sent.push(e),
    flush: () => {},
    base: () => ({ eventId: `e${sent.length}`, ts: 1, accountId: 'acc', visitorId: 'v', url: location.href }),
    ctx: () => ({
      win: window,
      url: location.href,
      device: 'desktop',
      isNew: true,
      profile: { pv: 1, s: 1, ev: {}, f: 0, l: 0, a: {} },
      ...ctx,
    }),
    onNavigate: [],
  };
}
const shown = () => document.querySelector('abt-engage');
const shadow = () => shown()!.shadowRoot!;

beforeEach(() => {
  sent = [];
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<button id="buy">Comprar</button>';
  history.replaceState(null, '', '/produto');
});

test('gatilho por tempo: mostra depois do atraso, registra view e fecha com evento', () => {
  vi.useFakeTimers();
  startEngage(window, boot([popup({ trigger: { type: 'delay', seconds: 3 } })]));
  vi.advanceTimersByTime(2900);
  expect(shown()).toBeNull();
  vi.advanceTimersByTime(200);
  expect(shadow().querySelector('h2')!.textContent).toBe('Ganhe 10%');
  expect(sent.map((e) => e.type === 'engage' && e.action)).toEqual(['view']);
  (shadow().querySelector('.x') as HTMLButtonElement).click();
  expect(shown()).toBeNull();
  expect(sent.map((e) => e.type === 'engage' && e.action)).toEqual(['view', 'close']);
  vi.useRealTimers();
});

test('frequência "uma vez": não volta a aparecer; textos nunca viram HTML', () => {
  vi.useFakeTimers();
  const p = popup({ trigger: { type: 'load' }, title: '<img src=x onerror=alert(1)>' });
  startEngage(window, boot([p]));
  vi.advanceTimersByTime(10);
  expect(shadow().querySelector('img')).toBeNull();
  expect(shadow().querySelector('h2')!.textContent).toContain('<img');
  shown()!.remove();
  startEngage(window, boot([p]));
  vi.advanceTimersByTime(10);
  expect(shown()).toBeNull();
  vi.useRealTimers();
});

test('segmentação: página, dispositivo e status', () => {
  vi.useFakeTimers();
  startEngage(
    window,
    boot([
      popup({
        id: 'a',
        trigger: { type: 'load' },
        targeting: { urls: [{ match: 'contains', value: '/checkout' }] },
      }),
      popup({ id: 'b', trigger: { type: 'load' }, targeting: { devices: ['mobile'] } }),
      popup({ id: 'c', trigger: { type: 'load' }, status: 'paused' }),
    ]),
  );
  vi.advanceTimersByTime(10);
  expect(shown()).toBeNull();
  vi.useRealTimers();
});

test('gatilho por clique e CTA registra clique', () => {
  startEngage(
    window,
    boot([popup({ trigger: { type: 'click', selector: '#buy' }, cta: { label: 'Quero', url: '/cupom' } })]),
  );
  expect(shown()).toBeNull();
  document.getElementById('buy')!.click();
  const cta = shadow().querySelector('.cta') as HTMLAnchorElement;
  expect(cta.getAttribute('href')).toBe('/cupom');
  cta.addEventListener('click', (e) => e.preventDefault());
  cta.click();
  expect(sent.map((e) => e.type === 'engage' && e.action)).toEqual(['view', 'click']);
});

test('CTA com javascript: não vira link', () => {
  startEngage(
    window,
    boot([
      popup({
        trigger: { type: 'click', selector: '#buy' },
        cta: { label: 'X', url: 'javascript:alert(1)' },
      }),
    ]),
  );
  document.getElementById('buy')!.click();
  expect((shadow().querySelector('.cta') as HTMLAnchorElement).getAttribute('href')).toBeNull();
});
