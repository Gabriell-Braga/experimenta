// @vitest-environment jsdom
import {
  ExperimentSchema,
  type HeatmapEvent,
  type PublishedConfig,
  type TrackingEvent,
} from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetProcessed } from './engine/apply';
import { installHeatmap, sampled } from './heatmap';
import { start } from './runtime';

const config: PublishedConfig = {
  accountId: 'acc',
  version: 1,
  publishedAt: '',
  experiments: [
    ExperimentSchema.parse({
      id: 'e1',
      key: 'hero',
      name: 'Hero',
      status: 'running',
      variations: [
        { id: 'v0', key: 'c', name: 'C', weight: 0 },
        { id: 'v1', key: 'b', name: 'B', weight: 1 },
      ],
    }),
  ],
};

let sent: TrackingEvent[];
let flushes: number;
// Tracker novo por teste: listeners de testes anteriores (window é compartilhado) ficam presos ao antigo.
let tracker: { send(e: TrackingEvent): void; flush(): void };
const heat = () => sent.filter((e): e is HeatmapEvent => e.type === 'click' || e.type === 'scroll');

beforeEach(() => {
  history.replaceState(null, '', '/home');
  document.body.innerHTML = '<main id="m"><button class="buy">Comprar</button></main>';
  localStorage.clear();
  resetProcessed();
  const mine: TrackingEvent[] = (sent = []);
  flushes = 0;
  tracker = { send: (e) => mine.push(e), flush: () => (sent === mine ? flushes++ : 0) };
});

test('amostragem determinística por visitante ~ taxa', () => {
  const ids = Array.from({ length: 5000 }, (_, i) => `v${i}`);
  const rate = ids.filter((id) => sampled(id, 0.2)).length / ids.length;
  expect(rate).toBeGreaterThan(0.17);
  expect(rate).toBeLessThan(0.23);
  expect(sampled('x', 0.2)).toBe(sampled('x', 0.2));
  expect(ids.some((id) => sampled(id, 0))).toBe(false);
});

test('clique: seletor do elemento, posição relativa, coordenadas, dispositivo e variações ativas', () => {
  const rt = start(window, config)!;
  expect(installHeatmap(window, rt, tracker, 1)).toBe(true);
  const btn = document.querySelector('.buy')!;
  btn.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 40 }) as DOMRect;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 60 }));
  const [c] = heat();
  expect(c).toMatchObject({
    type: 'click',
    selector: '#m > button',
    rx: 0.25,
    ry: 0.25,
    accountId: 'acc',
    visitorId: rt.visitor.id,
    device: expect.any(String),
    variations: { e1: 'v1' },
  });
  rt.stop();
});

test('scroll: uma medição por página — ao sair e ao navegar na SPA (com a URL antiga)', () => {
  const rt = start(window, config)!;
  installHeatmap(window, rt, tracker, 1);
  window.dispatchEvent(new Event('pagehide'));
  history.pushState(null, '', '/outra');
  const scrolls = heat().filter((e) => e.type === 'scroll');
  expect(scrolls.map((e) => new URL(e.url).pathname)).toEqual(['/home', '/home']);
  expect(scrolls[0]).toMatchObject({ depth: expect.any(Number), vh: expect.any(Number) });
  expect(flushes).toBe(2);
  rt.stop();
});

test('visitante fora da amostra não instala nada', () => {
  const rt = start(window, config)!;
  const spy = vi.spyOn(document, 'addEventListener');
  expect(installHeatmap(window, rt, tracker, 0)).toBe(false);
  expect(spy).not.toHaveBeenCalled();
  rt.stop();
});
