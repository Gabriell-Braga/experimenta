// @vitest-environment jsdom
import {
  ExperimentSchema,
  type HeatmapEvent,
  type PublishedConfig,
  type TrackingEvent,
} from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetProcessed } from '@abtest/snippet/engine';
import { insightsBoot, sampled } from '@abtest/snippet/insights';
import { start, type Runtime } from '@abtest/snippet/runtime';
import { startHeatmap } from './heatmap';

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
const HEAT = ['click', 'scroll', 'frustration', 'move'];
const heat = () => sent.filter((e): e is HeatmapEvent => HEAT.includes(e.type));

/** Como o snippet: só amostrados carregam o insights.js com o mapa de calor. */
function installHeatmap(win: Window, rt: Runtime, tr: typeof tracker, rate: number): boolean {
  if (!sampled(rt.visitor.id, rate)) return false;
  startHeatmap(win, insightsBoot(win, rt, tr, config));
  return true;
}

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

const click = (el: Element, x = 150, y = 60) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));

test('rage click: 3+ cliques rápidos no mesmo ponto geram um evento de frustração', () => {
  vi.useFakeTimers();
  const rt = start(window, config)!;
  installHeatmap(window, rt, tracker, 1);
  const btn = document.querySelector('.buy')!;
  for (let i = 0; i < 5; i++) {
    click(btn);
    vi.advanceTimersByTime(100);
  }
  vi.advanceTimersByTime(2000);
  const fr = heat().filter((e) => e.type === 'frustration');
  expect(fr).toEqual([expect.objectContaining({ kind: 'rage', selector: '#m > button', count: 3 })]);
  rt.stop();
  vi.useRealTimers();
});

test('dead click: clique sem reação da página em 1 s; clique que muda o DOM não conta', async () => {
  vi.useFakeTimers();
  const rt = start(window, config)!;
  installHeatmap(window, rt, tracker, 1);
  const btn = document.querySelector('.buy')!;
  click(btn);
  await vi.advanceTimersByTimeAsync(1100);
  btn.addEventListener('click', () => btn.append('!'));
  click(btn, 400, 400);
  await vi.advanceTimersByTimeAsync(1100);
  const dead = heat().filter((e) => e.type === 'frustration' && e.kind === 'dead');
  expect(dead).toHaveLength(1);
  rt.stop();
  vi.useRealTimers();
});

test('movimento do mouse: pontos amostrados enviados em lote ao sair da página', () => {
  vi.useFakeTimers();
  const rt = start(window, config)!;
  installHeatmap(window, rt, tracker, 1);
  for (let i = 0; i < 4; i++) {
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + i, clientY: 50 }));
  }
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 })); // < 150 ms: ignorado
  window.dispatchEvent(new Event('pagehide'));
  const mv = heat().filter((e) => e.type === 'move');
  expect(mv).toHaveLength(1);
  expect(mv[0]!.type === 'move' && mv[0]!.points).toHaveLength(4);
  rt.stop();
  vi.useRealTimers();
});
