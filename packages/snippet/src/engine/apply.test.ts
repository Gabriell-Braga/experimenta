// @vitest-environment jsdom
import type { Operation } from '@abtest/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyOperations, resetProcessed } from './apply';
import { INSERTED_ATTR } from './operations';

const HTML = `
  <main id="main">
    <h1 id="title">Título <em>original</em></h1>
    <p class="sub" style="color: blue">Sub</p>
    <a id="cta" class="btn" href="/a">Comprar</a>
    <img id="img" src="/a.png" srcset="/a@2x.png 2x" alt="A" />
    <ul id="list"><li id="li1">1</li><li id="li2">2</li><li id="li3">3</li></ul>
    <div id="late"></div>
  </main>`;

let n = 0;
const op = (o: Record<string, unknown>) =>
  ({
    id: `op${++n}`,
    order: n,
    target: { selector: '#title', alternates: [] },
    ...o,
  }) as unknown as Operation;
const t = (selector: string) => ({ selector, alternates: [] });
const $ = (s: string) => document.querySelector(s) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = HTML;
  resetProcessed();
});

describe('tipos de operação', () => {
  test('setText e setHTML', async () => {
    await applyOperations([op({ type: 'setText', value: '<b>texto</b>' })]).done;
    expect($('#title').innerHTML).toBe('&lt;b&gt;texto&lt;/b&gt;');
    await applyOperations([op({ type: 'setHTML', target: t('.sub'), value: '<b>novo</b>' })]).done;
    expect($('.sub b').textContent).toBe('novo');
  });

  test('setStyle com !important e remoção de propriedade', async () => {
    await applyOperations([
      op({ type: 'setStyle', target: t('.sub'), value: { color: 'red', 'font-size': '20px' } }),
    ]).done;
    expect($('.sub').style.getPropertyValue('color')).toBe('red');
    expect($('.sub').style.getPropertyPriority('color')).toBe('important');
    await applyOperations([op({ type: 'setStyle', target: t('.sub'), value: { color: '' } })]).done;
    expect($('.sub').style.getPropertyValue('color')).toBe('');
  });

  test('setAttribute define e remove', async () => {
    await applyOperations([
      op({ type: 'setAttribute', target: t('#cta'), value: { name: 'href', value: '/b' } }),
      op({ type: 'setAttribute', target: t('#cta'), value: { name: 'class', value: null } }),
    ]).done;
    expect($('#cta').getAttribute('href')).toBe('/b');
    expect($('#cta').hasAttribute('class')).toBe(false);
  });

  test('addClass / removeClass', async () => {
    await applyOperations([
      op({ type: 'addClass', target: t('#cta'), value: 'destaque' }),
      op({ type: 'removeClass', target: t('#cta'), value: 'btn' }),
    ]).done;
    expect($('#cta').className).toBe('destaque');
  });

  test('hide e remove', async () => {
    await applyOperations([
      op({ type: 'hide', target: t('.sub') }),
      op({ type: 'remove', target: t('#cta') }),
    ]).done;
    expect($('.sub').style.display).toBe('none');
    expect($('#cta')).toBeNull();
  });

  test('move antes/depois/dentro', async () => {
    await applyOperations([
      op({ type: 'move', target: t('#li3'), value: { position: 'before', anchor: t('#li1') } }),
    ]).done;
    expect([...$('#list').children].map((c) => c.id)).toEqual(['li3', 'li1', 'li2']);
    await applyOperations([
      op({ type: 'move', target: t('#cta'), value: { position: 'append', anchor: t('#list') } }),
    ]).done;
    expect($('#list').lastElementChild!.id).toBe('cta');
    await applyOperations([
      op({ type: 'move', target: t('#li1'), value: { position: 'after', anchor: t('#img') } }),
    ]).done;
    expect($('#img').nextElementSibling!.id).toBe('li1');
  });

  test('insertHTML marca os nós inseridos', async () => {
    const o = op({
      type: 'insertHTML',
      target: t('#title'),
      value: { position: 'after', html: '<p>A</p><p>B</p>' },
    });
    await applyOperations([o]).done;
    const inserted = document.querySelectorAll(`[${INSERTED_ATTR}="${o.id}"]`);
    expect([...inserted].map((e) => e.textContent)).toEqual(['A', 'B']);
    expect($('#title').nextElementSibling!.textContent).toBe('A');
  });

  test('replaceImage troca src, limpa srcset e troca alt', async () => {
    await applyOperations([
      op({ type: 'replaceImage', target: t('#img'), value: { src: '/b.png', alt: 'B' } }),
    ]).done;
    expect($('#img').getAttribute('src')).toBe('/b.png');
    expect($('#img').hasAttribute('srcset')).toBe(false);
    expect($('#img').getAttribute('alt')).toBe('B');
  });
});

describe('regras de aplicação', () => {
  test('aplica em ordem de `order`, não de posição no array', async () => {
    const a = op({ type: 'setText', value: 'primeiro' });
    const b = op({ type: 'setText', value: 'segundo' });
    await applyOperations([b, a]).done;
    expect($('#title').textContent).toBe('segundo');
  });

  test('idempotente: reaplicar não duplica insertHTML', async () => {
    const o = op({
      type: 'insertHTML',
      target: t('#list'),
      value: { position: 'append', html: '<li>novo</li>' },
    });
    await applyOperations([o]).done;
    await applyOperations([o]).done;
    expect($('#list').children).toHaveLength(4);
  });

  test('aguarda elemento que aparece depois (MutationObserver)', async () => {
    const onApplied = vi.fn();
    const h = applyOperations([op({ type: 'setText', target: t('.promo'), value: 'mudou' })], {
      timeoutMs: 500,
      onApplied,
    });
    setTimeout(() => ($('#late').innerHTML = '<div class="promo">original</div>'), 50);
    const r = await h.done;
    expect(r.failed).toEqual([]);
    expect($('.promo').textContent).toBe('mudou');
    expect(onApplied).toHaveBeenCalledOnce();
  });

  test('timeout reporta falha e segue aplicando as demais', async () => {
    const onFailed = vi.fn();
    const missing = op({ type: 'hide', target: t('#nao-existe') });
    const ok = op({ type: 'setText', value: 'ok' });
    const r = await applyOperations([missing, ok], { timeoutMs: 30, onFailed }).done;
    expect(r.failed).toEqual([missing]);
    expect(onFailed).toHaveBeenCalledWith(missing);
    expect($('#title').textContent).toBe('ok');
  });

  test('revert desfaz tudo na ordem inversa', async () => {
    const before = document.body.cloneNode(true);
    const h = applyOperations([
      op({ type: 'setText', value: 'x' }),
      op({ type: 'setStyle', target: t('.sub'), value: { color: 'red' } }),
      op({ type: 'remove', target: t('#li2') }),
      op({ type: 'move', target: t('#cta'), value: { position: 'prepend', anchor: t('#list') } }),
      op({ type: 'insertHTML', target: t('#list'), value: { position: 'before', html: '<hr>' } }),
      op({ type: 'replaceImage', target: t('#img'), value: { src: '/b.png' } }),
      op({ type: 'addClass', target: t('#cta'), value: 'y' }),
    ]);
    await h.done;
    expect(document.body.isEqualNode(before)).toBe(false);
    h.revert();
    // isEqualNode ignora a ordem dos atributos (srcset volta ao fim da lista).
    expect(document.body.isEqualNode(before)).toBe(true);
    // Depois de reverter, pode aplicar de novo.
    await applyOperations([op({ type: 'setText', value: 'de novo' })]).done;
    expect($('#title').textContent).toBe('de novo');
  });

  test('usa seletor alternativo e informa via', async () => {
    const r = await applyOperations([
      op({ type: 'setText', target: { selector: '#sumiu', alternates: ['h1'] }, value: 'curado' }),
    ]).done;
    expect(r.applied[0]!.res.via).toBe('alternate');
    expect($('h1').textContent).toBe('curado');
  });
});
