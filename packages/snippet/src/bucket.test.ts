import { describe, expect, test } from 'vitest';
import { assign, bucketOf, chooseVariation, murmurhash3 } from './bucket';

const v = (id: string, weight: number) => ({
  id,
  key: id,
  name: id,
  weight,
  operations: [],
  customCSS: '',
  customJS: '',
});
const exp = (traffic = 100, weights = [50, 50]) => ({
  id: 'exp-1',
  traffic,
  variations: weights.map((w, i) => v(`v${i}`, w)),
});
const visitors = Array.from({ length: 10000 }, (_, i) => `visitor-${i}-${(i * 7919).toString(36)}`);

function distribution(e: ReturnType<typeof exp>) {
  const counts: Record<string, number> & { none: number } = { none: 0 };
  for (const id of visitors) {
    const k = chooseVariation(id, e)?.id ?? 'none';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

describe('murmurhash3', () => {
  test('vetores de referência (x86_32)', () => {
    expect(murmurhash3('')).toBe(0);
    expect(murmurhash3('', 1)).toBe(0x514e28b7);
    expect(murmurhash3('hello')).toBe(0x248bfa47);
    expect(murmurhash3('Hello, world!', 1234)).toBe(0xfaf6cdb3);
    expect(murmurhash3('aaaa', 0x9747b28c)).toBe(0x5a97808a);
    expect(murmurhash3('abc')).toBe(0xb3dd93fa);
  });

  test('UTF-8', () => {
    expect(murmurhash3('ação')).toBe(murmurhash3('ação'));
    expect(murmurhash3('ação')).not.toBe(murmurhash3('acao'));
  });
});

describe('bucketing', () => {
  test('10.000 visitantes ficam ~50/50', () => {
    const c = distribution(exp());
    expect(c.none).toBe(0);
    expect(c.v0! / 10000).toBeGreaterThan(0.48);
    expect(c.v0! / 10000).toBeLessThan(0.52);
    expect(c.v0! + c.v1!).toBe(10000);
  });

  test('pesos 20/30/50', () => {
    const c = distribution(exp(100, [20, 30, 50]));
    expect(c.v0! / 10000).toBeCloseTo(0.2, 1);
    expect(c.v1! / 10000).toBeCloseTo(0.3, 1);
    expect(c.v2! / 10000).toBeCloseTo(0.5, 1);
  });

  test('tráfego de 30% e divisão interna 50/50', () => {
    const c = distribution(exp(30));
    expect(c.none / 10000).toBeCloseTo(0.7, 1);
    expect(c.v0! / (c.v0! + c.v1!)).toBeGreaterThan(0.46);
    expect(c.v0! / (c.v0! + c.v1!)).toBeLessThan(0.54);
  });

  test('tráfego 0 e peso 0', () => {
    expect(distribution(exp(0)).none).toBe(10000);
    expect(distribution(exp(100, [0, 1])).v0).toBeUndefined();
  });

  test('consistência: mesmo visitante, mesma variação; experimentos independentes', () => {
    for (const id of visitors.slice(0, 200))
      expect(chooseVariation(id, exp())).toEqual(chooseVariation(id, exp()));
    const same = visitors.filter(
      (id) => bucketOf(id, 'exp-1') < 5000 === bucketOf(id, 'exp-2') < 5000,
    ).length;
    expect(same / 10000).toBeGreaterThan(0.45);
    expect(same / 10000).toBeLessThan(0.55);
  });

  test('aumentar o tráfego não muda quem já estava dentro de variação (com persistência)', () => {
    const stored: Record<string, string> = {};
    const before = visitors.slice(0, 1000).map((id) => assign(id, exp(30), stored)?.id);
    const after = visitors.slice(0, 1000).map((id) => assign(id, exp(100), stored)?.id);
    before.forEach((b, i) => b && expect(after[i]).toBe(b));
  });

  test('atribuição persistida some se a variação foi removida', () => {
    const stored = { 'exp-1': 'apagada' };
    expect(assign('x', exp(), stored)?.id).toMatch(/^v[01]$/);
    expect(stored['exp-1']).toMatch(/^v[01]$/);
  });
});
