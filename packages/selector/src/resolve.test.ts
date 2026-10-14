// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { fingerprint } from './fingerprint';
import { generateSelector } from './generate';
import { findByFingerprint, resolveTarget } from './resolve';

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <h1 id="hero-title">O melhor tênis</h1>
      <a class="btn btn-primary" data-testid="cta" href="/produto">Comprar agora</a>
      <a class="btn" href="/outro">Ver mais</a>
      <p class="css-abc123">Frete grátis</p>
    </main>`;
});

const targetFor = (el: Element) => {
  const g = generateSelector(el);
  return { selector: g.selector, alternates: g.alternates, fingerprint: fingerprint(el) };
};

describe('fingerprint', () => {
  test('captura tag, texto resumido e atributos-chave', () => {
    const fp = fingerprint(document.querySelector('[data-testid=cta]')!);
    expect(fp.tag).toBe('a');
    expect(fp.text).toBe('Comprar agora');
    expect(fp.attrs).toEqual({ 'data-testid': 'cta', href: '/produto' });
    expect(fp.pos).toEqual({ x: 0, y: 0, w: 0, h: 0 }); // jsdom não tem layout
  });

  test('texto é normalizado e truncado em 80', () => {
    document.body.innerHTML = `<p>  ${'a'.repeat(100)}\n\n  b </p>`;
    expect(fingerprint(document.querySelector('p')!).text).toHaveLength(80);
  });
});

describe('resolveTarget', () => {
  test('principal', () => {
    const el = document.querySelector('#hero-title')!;
    expect(resolveTarget(targetFor(el))).toEqual({ el, via: 'primary', selector: '#hero-title' });
  });

  test('alternativo quando o principal quebra', () => {
    const el = document.querySelector('[data-testid=cta]')!;
    const t = targetFor(el);
    el.removeAttribute('data-testid');
    const r = resolveTarget(t)!;
    expect(r.el).toBe(el);
    expect(r.via).toBe('alternate');
  });

  test('impressão digital quando todos os seletores quebram (seletor curado)', () => {
    const el = document.querySelector('[data-testid=cta]')!;
    const t = targetFor(el);
    // Deploy do site muda classes, data-testid e href — só o texto sobrevive.
    el.className = 'css-zz9911';
    el.removeAttribute('data-testid');
    el.setAttribute('href', '/produto?ref=1');
    const r = resolveTarget(t)!;
    expect(r.el).toBe(el);
    expect(r.via).toBe('fingerprint');
    expect(document.querySelector(r.selector)).toBe(el);
  });

  test('não cura com candidato ambíguo nem fraco', () => {
    const fp = fingerprint(document.querySelector('.btn:not(.btn-primary)')!);
    document.querySelector('.btn:not(.btn-primary)')!.remove();
    expect(findByFingerprint(document, fp)).toBeNull();
    expect(resolveTarget({ selector: '.nada', alternates: [], fingerprint: fp })).toBeNull();
  });

  test('seletor inválido não quebra a resolução', () => {
    expect(resolveTarget({ selector: '###', alternates: ['h1'] })?.via).toBe('alternate');
  });

  test('elemento ausente sem impressão digital retorna null', () => {
    expect(resolveTarget({ selector: '#nao-existe', alternates: [] })).toBeNull();
  });
});
