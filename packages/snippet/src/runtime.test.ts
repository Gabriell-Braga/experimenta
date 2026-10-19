// @vitest-environment jsdom
import { ExperimentSchema, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { OK_ATTR } from './antiflicker';
import { resetProcessed } from './engine/apply';
import { start } from './runtime';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function config(variationB: object, extra: object = {}): PublishedConfig {
  return {
    accountId: 'acc',
    version: 1,
    publishedAt: new Date().toISOString(),
    experiments: [
      ExperimentSchema.parse({
        id: 'e1',
        key: 'hero',
        name: 'Hero',
        status: 'running',
        variations: [
          { id: 'v0', key: 'controle', name: 'Controle', weight: 0 },
          { id: 'v1', key: 'b', name: 'B', weight: 1, ...variationB },
        ],
        ...extra,
      }),
    ],
  };
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<h1 id="t">Original</h1><p class="sub">Sub</p>';
  localStorage.clear();
  resetProcessed();
});

test('aplica a variação, revela o elemento e emite exposure', async () => {
  const events: TrackingEvent[] = [];
  const rt = start(
    window,
    config({
      operations: [{ id: 'o1', order: 0, type: 'setText', target: { selector: '#t' }, value: 'Novo' }],
    }),
    { sink: (e) => events.push(e) },
  )!;
  expect(document.querySelector('#t')!.textContent).toBe('Novo');
  expect(document.querySelector('#t')!.hasAttribute(OK_ATTR)).toBe(true);
  expect(events.map((e) => e.type)).toEqual(['exposure']);
  expect(events[0]).toMatchObject({
    accountId: 'acc',
    experimentKey: 'hero',
    variationKey: 'b',
    visitorId: rt.visitor.id,
  });
  await tick();
  expect(document.querySelector('style[data-abt-antiflicker]')).toBeNull();
  expect(JSON.parse(localStorage.getItem('_abt_a')!)).toEqual({ e1: 'v1' });
});

test('anti-flicker esconde só os seletores alterados até aplicar; timeout libera', async () => {
  const cfg = config(
    { operations: [{ id: 'o1', order: 0, type: 'setText', target: { selector: '.tarde' }, value: 'x' }] },
    { antiFlicker: { mode: 'element', timeoutMs: 50 } },
  );
  const events: TrackingEvent[] = [];
  start(window, cfg, { sink: (e) => events.push(e) });
  const style = document.querySelector('style[data-abt-antiflicker="element"]')!;
  expect(style.textContent).toContain(':is(.tarde):not([data-abt-ok]){visibility:hidden!important}');
  await tick(80);
  expect(style.isConnected).toBe(false);
  expect(events.map((e) => e.type)).toEqual(['exposure', 'selector_failed']);
});

test('modo página esconde html inteiro', () => {
  start(
    window,
    config(
      { operations: [{ id: 'o1', order: 0, type: 'hide', target: { selector: '.nao-existe' } }] },
      { antiFlicker: { mode: 'page', timeoutMs: 1500 } },
    ),
  );
  expect(document.querySelector('style[data-abt-antiflicker="page"]')!.textContent).toBe(
    'html{opacity:0!important}',
  );
});

test('seletor curado emite selector_healed', () => {
  const events: TrackingEvent[] = [];
  start(
    window,
    config({
      operations: [
        {
          id: 'o1',
          order: 0,
          type: 'setText',
          target: { selector: '#sumiu', alternates: ['h1'] },
          value: 'ok',
        },
      ],
    }),
    { sink: (e) => events.push(e) },
  );
  expect(events.find((e) => e.type === 'selector_healed')).toMatchObject({
    healedSelector: 'h1',
    via: 'alternate',
  });
});

test('customCSS e customJS', async () => {
  start(window, config({ customCSS: '.sub{color:red}', customJS: 'document.body.dataset.js = "rodou";' }));
  expect(document.querySelector('style[data-abt-css="v1"]')!.textContent).toBe('.sub{color:red}');
  expect(document.body.dataset.js).toBe('rodou');
});

test('segmentação que não bate não ativa; variação forçada ignora segmentação', () => {
  const cfg = config(
    { operations: [{ id: 'o1', order: 0, type: 'setText', target: { selector: '#t' }, value: 'Novo' }] },
    { segmentation: { urls: [{ match: 'contains', value: '/outra' }] } },
  );
  expect(start(window, cfg)!.active.size).toBe(0);
  expect(start(window, cfg, { forced: { hero: 'controle' } })!.active.get('e1')!.variation.key).toBe(
    'controle',
  );
});

test('SPA: pushState/popstate reavaliam a segmentação, ativam e revertem', async () => {
  history.replaceState(null, '', '/');
  const events: TrackingEvent[] = [];
  const rt = start(
    window,
    config(
      {
        operations: [{ id: 'o1', order: 0, type: 'setText', target: { selector: '.preco' }, value: 'R$ 9' }],
      },
      { segmentation: { urls: [{ match: 'contains', value: '/planos' }] } },
    ),
    { sink: (e) => events.push(e) },
  )!;
  const urls: string[] = [];
  rt.onNavigate.push((u) => urls.push(u));
  expect(rt.active.size).toBe(0);

  history.pushState(null, '', '/planos');
  document.body.innerHTML = '<p class="preco">R$ 10</p>'; // rota renderiza depois
  await tick();
  expect(rt.active.size).toBe(1);
  expect(document.querySelector('.preco')!.textContent).toBe('R$ 9');

  history.pushState(null, '', '/sobre');
  expect(rt.active.size).toBe(0);
  expect(document.querySelector('.preco')!.textContent).toBe('R$ 10'); // revertido

  history.back();
  // popstate é assíncrono no jsdom: espera em vez de um atraso fixo (instável com a máquina carregada).
  await vi.waitFor(() => expect(rt.active.size).toBe(1));
  expect(urls.map((u) => new URL(u).pathname)).toEqual(['/planos', '/sobre', '/planos']);
  expect(events.filter((e) => e.type === 'exposure')).toHaveLength(2);
  rt.stop();
  history.pushState(null, '', '/sobre');
  expect(urls).toHaveLength(3); // patches desfeitos
});
