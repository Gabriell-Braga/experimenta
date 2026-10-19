import { expect, test } from 'vitest';
import {
  chiSquareSf,
  compareMeans,
  compareRates,
  meanVar,
  normCdf,
  normInv,
  sampleSize,
  srm,
  verdict,
  zTest,
} from './stats';

/** P(B > A) exato para posteriores Beta (Evan Miller), para conferir o Monte Carlo. */
function exactProbBBeatsA(a: { s: number; f: number }, b: { s: number; f: number }) {
  const lbeta = (x: number, y: number) => lg(x) + lg(y) - lg(x + y);
  const lg = (z: number): number => {
    let s = 0;
    for (let i = 1; i < z; i++) s += Math.log(i);
    return s; // ln Γ(z) para z inteiro
  };
  const [aA, bA, aB, bB] = [a.s + 1, a.f + 1, b.s + 1, b.f + 1];
  let total = 0;
  for (let i = 0; i < aB; i++)
    total += Math.exp(lbeta(aA + i, bA + bB) - Math.log(bB + i) - lbeta(1 + i, bB) - lbeta(aA, bA));
  return total;
}

test('normal: CDF e inversa', () => {
  expect(normCdf(0)).toBeCloseTo(0.5, 6);
  expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
  expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
  expect(normInv(0.01)).toBeCloseTo(-2.326348, 5);
});

test('qui-quadrado: valores críticos de 5%', () => {
  expect(chiSquareSf(3.841459, 1)).toBeCloseTo(0.05, 4);
  expect(chiSquareSf(5.991465, 2)).toBeCloseTo(0.05, 4);
  expect(chiSquareSf(18.307038, 10)).toBeCloseTo(0.05, 4);
  expect(chiSquareSf(0, 3)).toBe(1);
});

test('z-test de duas proporções', () => {
  expect(zTest({ visitors: 1000, conversions: 100 }, { visitors: 1000, conversions: 130 })).toBeCloseTo(
    0.0355,
    3,
  );
  expect(zTest({ visitors: 1000, conversions: 100 }, { visitors: 1000, conversions: 100 })).toBeCloseTo(1, 6);
  expect(zTest({ visitors: 0, conversions: 0 }, { visitors: 10, conversions: 1 })).toBe(1);
});

test('bayesiano: Monte Carlo bate com a fórmula exata de P(B > A)', () => {
  const [, b] = compareRates([
    { visitors: 100, conversions: 20 },
    { visitors: 100, conversions: 30 },
  ]);
  const exact = exactProbBBeatsA({ s: 20, f: 80 }, { s: 30, f: 70 });
  expect(b!.probBeatControl!).toBeCloseTo(exact, 2);
  expect(b!.lift!).toBeGreaterThan(0.3);
  expect(b!.lift!).toBeLessThan(0.6);
  expect(b!.liftLow!).toBeLessThan(0);
  expect(b!.rateLow).toBeLessThan(0.3);
  expect(b!.rateHigh).toBeGreaterThan(0.3);
});

test('bayesiano: braços iguais ≈ 50%; diferença forte ≈ 100%; perda esperada menor no melhor', () => {
  const eq = compareRates([
    { visitors: 5000, conversions: 500 },
    { visitors: 5000, conversions: 500 },
  ]);
  expect(eq[1]!.probBeatControl!).toBeGreaterThan(0.45);
  expect(eq[1]!.probBeatControl!).toBeLessThan(0.55);
  const strong = compareRates([
    { visitors: 5000, conversions: 500 },
    { visitors: 5000, conversions: 650 },
    { visitors: 5000, conversions: 480 },
  ]);
  expect(strong[1]!.probBeatControl!).toBeGreaterThan(0.999);
  expect(strong[1]!.probBest).toBeGreaterThan(0.99);
  expect(strong[0]!.probBest + strong[1]!.probBest + strong[2]!.probBest).toBeCloseTo(1, 6);
  expect(strong[1]!.expectedLoss).toBeLessThan(strong[0]!.expectedLoss);
  expect(strong[0]!.lift).toBeNull();
  // Reprodutível (semente fixa).
  expect(
    compareRates([
      { visitors: 10, conversions: 1 },
      { visitors: 10, conversions: 2 },
    ]),
  ).toEqual(
    compareRates([
      { visitors: 10, conversions: 1 },
      { visitors: 10, conversions: 2 },
    ]),
  );
});

test('receita por visitante: médias diferentes com variância', () => {
  const a = meanVar(Array.from({ length: 2000 }, (_, i) => (i % 10 === 0 ? 100 : 0))); // média 10
  const b = meanVar(Array.from({ length: 2000 }, (_, i) => (i % 8 === 0 ? 100 : 0))); // média 12,5
  expect(a.mean).toBeCloseTo(10, 6);
  const [, rb] = compareMeans([a, b]);
  expect(rb!.probBeatControl!).toBeGreaterThan(0.95);
  expect(rb!.lift!).toBeCloseTo(0.25, 1);
  expect(rb!.pValue!).toBeLessThan(0.05);
});

test('SRM: divisão esperada passa; desvio grande é detectado', () => {
  expect(srm([5000, 5000], [1, 1]).mismatch).toBe(false);
  expect(srm([5000, 5010], [50, 50]).pValue).toBeGreaterThan(0.5);
  expect(srm([5000, 5400], [1, 1]).mismatch).toBe(true);
  expect(srm([2500, 7500], [25, 75]).mismatch).toBe(false);
  expect(srm([0, 0], [1, 1]).mismatch).toBe(false);
});

test('tamanho de amostra por variação (α 5%, poder 80%)', () => {
  expect(sampleSize(0.1, 0.2)).toBeGreaterThan(3830);
  expect(sampleSize(0.1, 0.2)).toBeLessThan(3850);
  expect(sampleSize(0.03, 0.1)).toBeGreaterThan(50_000);
  expect(sampleSize(0, 0.1)).toBe(Infinity);
});

test('veredito', () => {
  const [c, b] = compareRates([
    { visitors: 5000, conversions: 500 },
    { visitors: 5000, conversions: 650 },
  ]);
  expect(verdict(c!, 100, 10000)).toBe('baseline');
  expect(verdict(b!, 100, 10000)).toBe('winner');
  expect(verdict(b!, 100_000, 10000)).toBe('inconclusive');
});

test('bandit: mais tráfego para quem tem mais chance de ser o melhor, com piso de exploração', async () => {
  const { banditWeights } = await import('./stats');
  expect(
    banditWeights([
      { visitors: 10, conversions: 1 },
      { visitors: 10, conversions: 5 },
    ]),
  ).toEqual([500, 500]); // poucos dados
  const w = banditWeights([
    { visitors: 2000, conversions: 200 },
    { visitors: 2000, conversions: 300 },
    { visitors: 2000, conversions: 190 },
  ]);
  expect(w[1]!).toBeGreaterThan(850);
  expect(w[0]!).toBeGreaterThanOrEqual(50); // piso de 5%
  expect(w[2]!).toBeGreaterThanOrEqual(50);
  expect(w.reduce((s, x) => s + x, 0)).toBeGreaterThan(990);
  expect(w.reduce((s, x) => s + x, 0)).toBeLessThan(1010);
});
