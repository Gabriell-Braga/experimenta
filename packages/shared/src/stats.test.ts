import { expect, test } from 'vitest';
import {
  chiSquareSf,
  compareMeans,
  compareRates,
  cuped,
  meanVar,
  msprt,
  rateInput,
  rng,
  normCdf,
  normInv,
  sampleSize,
  srm,
  verdict,
  welch,
  zTest,
  type MeanInput,
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

/** Simula `reps` testes com `looks` olhadas de `step` visitantes por braço; fração que deu p < 0,05 em ALGUMA. */
function peeking(pA: number, pB: number, test: (a: MeanInput, b: MeanInput) => number, reps = 400) {
  const r = rng(2026);
  const looks = 20;
  const step = 500;
  let rejected = 0;
  for (let k = 0; k < reps; k++) {
    let ca = 0;
    let cb = 0;
    for (let l = 1; l <= looks; l++) {
      for (let i = 0; i < step; i++) {
        if (r() < pA) ca++;
        if (r() < pB) cb++;
      }
      const n = l * step;
      if (
        test(rateInput({ visitors: n, conversions: ca }), rateInput({ visitors: n, conversions: cb })) < 0.05
      ) {
        rejected++;
        break;
      }
    }
  }
  return rejected / reps;
}

test('teste sequencial: olhar 20 vezes num A/A não infla o falso positivo (z-test ingênuo infla)', () => {
  const seq = peeking(0.1, 0.1, (a, b) => msprt(a, b).pValue);
  const naive = peeking(0.1, 0.1, (a, b) => welch(a, b));
  expect(seq).toBeLessThanOrEqual(0.05);
  expect(naive).toBeGreaterThan(0.12); // espiar com p-valor fixo dá ~2–4× α
  // Com efeito real (+20%) ainda detecta na maioria das vezes.
  expect(peeking(0.1, 0.12, (a, b) => msprt(a, b).pValue, 200)).toBeGreaterThan(0.8);
});

test('teste sequencial: fórmula, intervalo contém o efeito e casos sem dados', () => {
  const a = { n: 10_000, mean: 0.1, variance: 0.09 };
  const b = { n: 10_000, mean: 0.12, variance: 0.1056 };
  const t = msprt(a, b);
  const v = 0.09 / 10_000 + 0.1056 / 10_000;
  const tau2 = 0.01 ** 2;
  const lambda = Math.sqrt(v / (v + tau2)) * Math.exp((tau2 * 0.02 ** 2) / (2 * v * (v + tau2)));
  expect(t.pValue).toBeCloseTo(1 / lambda, 10);
  expect(t.low!).toBeGreaterThan(0);
  expect(t.low! < 0.02 && 0.02 < t.high!).toBe(true);
  // Intervalo sempre válido é mais largo que o de 95% fixo.
  expect(t.high! - t.low!).toBeGreaterThan(2 * 1.96 * Math.sqrt(v));
  expect(msprt({ n: 1, mean: 0, variance: 0 }, { n: 1, mean: 0, variance: 0 })).toMatchObject({
    pValue: 1,
    low: null,
  });
  expect(msprt({ n: 10, mean: 0, variance: 0 }, { n: 10, mean: 0, variance: 0 }).pValue).toBe(1);
});

test('veredito sequencial: vencedora/perdedora só com p sempre válido < α', () => {
  const r = { probBeatControl: 0.99 } as Parameters<typeof verdict>[0];
  expect(verdict(r, 100, 500)).toBe('winner');
  expect(verdict(r, 100, 500, { pValue: 0.2, diff: 0.01 })).toBe('leading');
  expect(verdict(r, 100, 500, { pValue: 0.01, diff: 0.01 })).toBe('winner');
  expect(verdict({ ...r, probBeatControl: 0.01 }, 100, 500, { pValue: 0.01, diff: -0.01 })).toBe('loser');
  expect(verdict(r, 100, 50, { pValue: 0.001, diff: 0.01 })).toBe('inconclusive');
});

test('CUPED: tira a variância explicada pela covariável e não muda a média', () => {
  const r = rng(5);
  const x = Array.from({ length: 2000 }, () => Math.floor(r() * 10));
  const y = x.map((v) => 2 * v + (r() - 0.5));
  const c = cuped(y, x);
  expect(c.theta).toBeCloseTo(2, 1);
  expect(c.reduction).toBeGreaterThan(0.95);
  const before = meanVar(y);
  const after = meanVar(c.adjusted);
  expect(after.mean).toBeCloseTo(before.mean, 8);
  expect(after.variance / before.variance).toBeCloseTo(1 - c.reduction, 6);
  // Sem histórico (todos 0): nada muda.
  expect(
    cuped(
      y,
      x.map(() => 0),
    ),
  ).toMatchObject({ adjusted: y, theta: 0, reduction: 0 });
});
