// @vitest-environment jsdom
// Cenários de DOM que muda: elementos tardios, re-render de framework, âncoras tardias e cura.
import { fingerprint } from '@abtest/selector';
import type { Operation } from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { applyOperations, resetProcessed } from './apply';

let n = 0;
const op = (o: Record<string, unknown>) => ({ id: `op${++n}`, order: n, ...o }) as unknown as Operation;
const t = (selector: string) => ({ selector, alternates: [] });
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  resetProcessed();
});

/** Simula um framework que recria a árvore inteira (como hidratação/re-render do React). */
const render = (html: string) => ($('#app').innerHTML = html);

test('vários elementos chegando em lotes diferentes', async () => {
  const h = applyOperations(
    [
      op({ type: 'setText', target: t('.a'), value: 'A!' }),
      op({ type: 'setText', target: t('.b'), value: 'B!' }),
      op({ type: 'hide', target: t('.c') }),
    ],
    { timeoutMs: 300 },
  );
  render('<p class="a">a</p>');
  await tick(10);
  $('#app').insertAdjacentHTML('beforeend', '<p class="b">b</p>');
  await tick(10);
  $('#app').insertAdjacentHTML('beforeend', '<p class="c">c</p>');
  const r = await h.done;
  expect(r.failed).toHaveLength(0);
  expect($('.a').textContent + $('.b').textContent).toBe('A!B!');
  expect($('.c').style.display).toBe('none');
});

test('move aguarda a âncora que chega depois do alvo', async () => {
  render('<p id="alvo">alvo</p>');
  const h = applyOperations(
    [op({ type: 'move', target: t('#alvo'), value: { position: 'after', anchor: t('#ancora') } })],
    {
      timeoutMs: 300,
    },
  );
  await tick(10);
  expect($('#alvo').nextElementSibling).toBeNull();
  $('#app').insertAdjacentHTML('afterbegin', '<h2 id="ancora">âncora</h2>');
  await h.done;
  expect($('#ancora').nextElementSibling!.id).toBe('alvo');
});

test('persist: re-render que troca o nó recebe a operação de novo', async () => {
  render('<h1 class="title">original</h1>');
  const onApplied = vi.fn();
  const h = applyOperations([op({ type: 'setText', target: t('.title'), value: 'variação' })], {
    persist: true,
    onApplied,
  });
  await h.done;
  expect($('.title').textContent).toBe('variação');
  render('<h1 class="title">original</h1>'); // framework recria o nó
  await tick(10);
  expect($('.title').textContent).toBe('variação');
  expect(onApplied).toHaveBeenCalledOnce(); // evento de aplicação só uma vez
  h.stop();
  render('<h1 class="title">original</h1>');
  await tick(10);
  expect($('.title').textContent).toBe('original');
});

test('sem persist, re-render posterior não é reaplicado', async () => {
  render('<h1 class="title">original</h1>');
  await applyOperations([op({ type: 'setText', target: t('.title'), value: 'variação' })]).done;
  render('<h1 class="title">original</h1>');
  await tick(10);
  expect($('.title').textContent).toBe('original');
});

test('deploy do site muda o seletor: cura pela impressão digital durante a aplicação', async () => {
  render('<button class="btn-buy" data-testid="buy">Comprar agora</button><button>Cancelar</button>');
  const btn = $('[data-testid=buy]');
  const target = {
    selector: '[data-testid="buy"]',
    alternates: ['button.btn-buy'],
    fingerprint: fingerprint(btn),
  };
  render('<button class="css-x1y2z3">Comprar agora</button><button>Cancelar</button>'); // novo deploy
  const r = await applyOperations([op({ type: 'setStyle', target, value: { color: 'red' } })]).done;
  expect(r.applied[0]!.res.via).toBe('fingerprint');
  expect($('.css-x1y2z3').style.color).toBe('red');
});

test('stop() interrompe a espera sem reportar falha', async () => {
  const onFailed = vi.fn();
  const h = applyOperations([op({ type: 'hide', target: t('.nunca') })], { timeoutMs: 50, onFailed });
  h.stop();
  const r = await h.done;
  await tick(80);
  expect(onFailed).not.toHaveBeenCalled();
  expect(r.failed).toHaveLength(0);
});

test('operação aplicada a um nó removido e recriado não vaza undo inválido', async () => {
  render('<p class="x">1</p>');
  const h = applyOperations([op({ type: 'addClass', target: t('.x'), value: 'novo' })], { persist: true });
  await h.done;
  render('<p class="x">2</p>');
  await tick(10);
  expect($('.x').classList.contains('novo')).toBe(true);
  expect(() => h.revert()).not.toThrow();
  expect($('.x').classList.contains('novo')).toBe(false);
});
