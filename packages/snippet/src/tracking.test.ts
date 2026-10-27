// @vitest-environment jsdom
import { ExperimentSchema, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetProcessed } from './engine/apply';
import { installGoals } from './goals';
import { readForce } from './qa';
import { qaPanel } from './qapanel';
import { start } from './runtime';
import { createTracker } from './tracker';

const config = (): PublishedConfig => ({
  accountId: 'acc',
  version: 1,
  publishedAt: new Date().toISOString(),
  experiments: [
    ExperimentSchema.parse({
      id: 'e1',
      key: 'hero',
      name: 'Hero',
      status: 'running',
      segmentation: { urls: [{ match: 'contains', value: '/home' }] },
      variations: [
        { id: 'v0', key: 'controle', name: 'Controle', weight: 0 },
        { id: 'v1', key: 'b', name: 'B', weight: 1 },
      ],
      goals: [
        { id: 'g1', key: 'cta', type: 'click', selector: '.cta' },
        { id: 'g2', key: 'news', type: 'formSubmit', selector: '#news' },
        { id: 'g3', key: 'obrigado', type: 'pageview', url: { match: 'contains', value: '/obrigado' } },
        { id: 'g4', key: 'signup', type: 'custom', event: 'signup' },
      ],
    }),
  ],
});

beforeEach(() => {
  history.replaceState(null, '', '/home');
  document.body.innerHTML =
    '<a class="cta"><span>Comprar</span></a><form id="news"><button>ok</button></form>';
  localStorage.clear();
  sessionStorage.clear();
  resetProcessed();
});

test('metas: clique (em filho), envio de formulário, visita a URL (em outra página) e custom', () => {
  const events: TrackingEvent[] = [];
  const rt = start(window, config(), { sink: (e) => events.push(e) })!;
  const track = installGoals(window, rt);
  document.querySelector('span')!.click();
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  history.pushState(null, '', '/obrigado'); // experimento não está ativo aqui, mas o visitante está nele
  track('signup', 42);
  track('outro');
  const conv = events.filter((e) => e.type === 'conversion');
  expect(conv.map((e) => e.type === 'conversion' && [e.goalKey, e.value])).toEqual([
    ['cta', undefined],
    ['news', undefined],
    ['obrigado', undefined],
    ['signup', 42],
  ]);
  expect(conv.every((e) => e.variationKey === 'b' && !e.qa)).toBe(true);
  rt.stop();
});

test('visitante fora de qualquer experimento não converte', () => {
  history.replaceState(null, '', '/blog');
  const events: TrackingEvent[] = [];
  const rt = start(window, config(), { sink: (e) => events.push(e) })!;
  installGoals(window, rt);
  document.querySelector('span')!.click();
  expect(events).toEqual([]);
  rt.stop();
});

test('tracker: lote, CustomEvent, adaptador plugável e flush ao esconder a página', () => {
  vi.useFakeTimers();
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  const t = createTracker(window, 'https://api/collect', 1000);
  const extra = vi.fn();
  t.addAdapter(extra);
  const dom = vi.fn();
  window.addEventListener('abt:event', dom);
  const ev = { type: 'exposure' } as TrackingEvent;
  t.send(ev);
  t.send(ev);
  expect(dom).toHaveBeenCalledTimes(2);
  expect(beacon).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(beacon).toHaveBeenCalledOnce();
  expect(extra).toHaveBeenCalledWith([ev, ev]);
  t.send(ev);
  window.dispatchEvent(new Event('pagehide'));
  expect(beacon).toHaveBeenCalledTimes(2);
  t.send({ type: 'conversion' } as TrackingEvent);
  expect(beacon).toHaveBeenCalledTimes(3); // conversão envia na hora
  t.addAdapter(() => {
    throw new Error('adaptador quebrado');
  });
  t.send(ev);
  expect(() => t.flush()).not.toThrow();
  vi.useRealTimers();
});

test('modo QA: ab_force força variação, marca eventos como qa e persiste na sessão', () => {
  history.replaceState(null, '', '/blog?ab_force=hero:controle');
  const forced = readForce(window)!;
  expect(forced).toEqual({ hero: 'controle' });
  const events: TrackingEvent[] = [];
  const rt = start(window, config(), { forced, sink: (e) => events.push(e) })!;
  expect(rt.active.get('e1')!.variation.key).toBe('controle'); // ignora segmentação (/blog)
  expect(events[0]!.qa).toBe(true);
  history.replaceState(null, '', '/outra');
  expect(readForce(window)).toEqual({ hero: 'controle' });
  history.replaceState(null, '', '/outra?ab_force=off');
  expect(readForce(window)).toBeUndefined();
  rt.stop();
});

test('painel de QA em Shadow DOM: sem runtime avisa; fechar remove', () => {
  const { host } = qaPanel(window, null, 'Modo QA <x>');
  expect(host.isConnected).toBe(true);
  expect(host.shadowRoot!.textContent).toContain('Modo QA <x>');
  (host.shadowRoot!.querySelector('[data-a="close"]') as HTMLElement).click();
  expect(host.isConnected).toBe(false);
});
