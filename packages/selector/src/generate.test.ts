// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { cssEscape, generateSelector, nthPath } from './generate';
import { isGeneratedToken, isStableClass } from './stability';

describe('isGeneratedToken', () => {
  test.each([
    'css-1x2y3z',
    'css-abc123-Button',
    'sc-bdVaJa',
    'jsx-123456',
    'Button__root__3xYz1',
    '_btn_x7a2f_12',
    'a8f3c91e',
    'ember123',
    ':r1:',
    '1col',
    'item-1696512345',
    'x9Kq2',
  ])('gerado: %s', (t) => expect(isGeneratedToken(t)).toBe(true));

  test.each([
    'btn',
    'btn-primary',
    'hero-title',
    'mt-4',
    'col-md-12',
    'MuiButton',
    'navBar',
    'plan-featured',
  ])('estável: %s', (t) => expect(isGeneratedToken(t)).toBe(false));

  test('classes de estado não são estáveis', () => {
    expect(isStableClass('active')).toBe(false);
    expect(isStableClass('is-open')).toBe(false);
    expect(isStableClass('card')).toBe(true);
  });
});

describe('generateSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header class="site-header"><a class="logo" href="/">Loja</a></header>
      <main>
        <section id="hero">
          <h1 id="hero-title">Título</h1>
          <p class="hero-subtitle">Sub</p>
          <a class="btn btn-primary" data-testid="cta" href="/produto">Comprar</a>
          <a class="btn" href="/outro">Outro</a>
        </section>
        <section id="a8f3c91e">
          <div class="plan"><p class="price">R$ 1</p></div>
          <div class="plan plan-featured"><p class="price">R$ 2</p></div>
        </section>
        <ul class="css-1x2y3z"><li>um</li><li>dois</li><li>três</li></ul>
        <div class="sc-bdVaJa"><span class="css-9k8j7h">sem âncora</span></div>
      </main>`;
  });
  const q = (s: string) => document.querySelector(s)!;
  const resolves = (sel: string, el: Element) =>
    expect(document.querySelectorAll(sel)).toEqual(expect.objectContaining({ length: 1, 0: el }));

  test('id estável tem prioridade', () => {
    const r = generateSelector(q('#hero-title'));
    expect(r.selector).toBe('#hero-title');
    expect(r.fragility).toBe('low');
  });

  test('data-* vem antes de classes', () => {
    const r = generateSelector(q('[data-testid=cta]'));
    expect(r.selector).toBe('[data-testid="cta"]');
    expect(r.alternates.length).toBeGreaterThan(0);
    for (const s of [r.selector, ...r.alternates]) resolves(s, q('[data-testid=cta]'));
  });

  test('classe estável única', () => {
    expect(generateSelector(q('.hero-subtitle')).selector).toBe('p.hero-subtitle');
  });

  test('ignora id gerado e ancora em ancestral estável', () => {
    const el = q('.plan-featured .price');
    const r = generateSelector(el);
    expect(r.selector).not.toContain('a8f3c91e');
    expect(r.selector).toBe('div.plan-featured p.price');
    resolves(r.selector, el);
  });

  test('ignora classes CSS-in-JS e cai em nth-of-type', () => {
    const li = document.querySelectorAll('li')[1]!;
    const r = generateSelector(li);
    expect(r.selector).not.toMatch(/css-|sc-/);
    expect(r.selector).toContain('nth-of-type(2)');
    expect(r.fragility).toBe('high');
    resolves(r.selector, li);
  });

  test('todo seletor gerado resolve para o próprio elemento', () => {
    for (const el of document.body.querySelectorAll('*')) {
      const r = generateSelector(el);
      for (const s of [r.selector, ...r.alternates]) resolves(s, el);
    }
  });

  test('nthPath e cssEscape', () => {
    expect(nthPath(document.querySelectorAll('li')[2]!)).toBe('body > main > ul > li:nth-of-type(3)');
    expect(cssEscape('1abc')).toBe('\\31 abc');
    expect(cssEscape('a:b')).toBe('a\\:b');
  });
});

test('data-* com id numérico curto serve de âncora (cards de produto renderizados por JS)', () => {
  document.body.innerHTML = `<div id="grid">${[1, 2, 3]
    .map(
      (i) =>
        `<article class="card pc_x7a2f_3" data-product-id="${i}"><div class="card__body"><h3 class="card__title">P${i}</h3></div></article>`,
    )
    .join('')}</div>`;
  const r = generateSelector(document.querySelectorAll('h3')[1]!);
  expect(r.selector).toBe('[data-product-id="2"] h3.card__title');
  expect(r.fragility).not.toBe('high');
});
