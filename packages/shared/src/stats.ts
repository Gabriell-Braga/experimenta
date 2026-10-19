// Motor estatístico dos relatórios (sem dependências; roda na API e no editor).
// Bayesiano (como o SmartStats do VWO): posteriores Beta para taxas de conversão e Normal para receita por
// visitante, amostradas por Monte Carlo com semente fixa (resultado reprodutível). Frequentista ao lado
// (z-test / Welch) para quem prefere p-valor. SRM por qui-quadrado. Tamanho de amostra por aproximação normal.

/** PRNG determinístico (mulberry32). */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Gamma(shape, 1) — Marsaglia & Tsang. */
function gamma(shape: number, r: () => number): number {
  if (shape < 1) return gamma(shape + 1, r) * r() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(r);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(a: number, b: number, r: () => number): number {
  const x = gamma(a, r);
  return x / (x + gamma(b, r));
}

/** Φ(x): CDF da normal padrão (erf de Abramowitz-Stegun 7.1.26, erro < 1,5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Φ⁻¹(p) — algoritmo de Acklam (erro relativo < 1,2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

function lnGamma(z: number): number {
  // Lanczos (g = 7).
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = g[0]!;
  for (let i = 1; i < 9; i++) x += g[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** P(X > x) para X ~ qui-quadrado com k graus de liberdade (gama incompleta regularizada). */
export function chiSquareSf(x: number, k: number): number {
  if (x <= 0) return 1;
  const s = k / 2;
  const z = x / 2;
  if (z < s + 1) {
    // Série da gama inferior.
    let sum = 1 / s;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= z / (s + n);
      sum += term;
      if (term < sum * 1e-14) break;
    }
    return 1 - Math.exp(-z + s * Math.log(z) - lnGamma(s)) * sum;
  }
  // Fração contínua (Lentz) da gama superior.
  let b = z + 1 - s;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    d = Math.abs(d) < 1e-300 ? 1e-300 : 1 / d;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-z + s * Math.log(z) - lnGamma(s)) * h;
}

const quantile = (sorted: Float64Array, q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;

export interface ArmInput {
  visitors: number;
  conversions: number;
}

export interface ArmResult {
  rate: number;
  /** Intervalo de credibilidade de 95% da taxa. */
  rateLow: number;
  rateHigh: number;
  /** Melhoria relativa vs controle (mediana do posterior) e intervalo de 95%. null no controle. */
  lift: number | null;
  liftLow: number | null;
  liftHigh: number | null;
  /** P(esta > controle). null no controle. */
  probBeatControl: number | null;
  /** P(esta é a melhor de todas). */
  probBest: number;
  /** Perda esperada (em taxa absoluta) se esta for escolhida. */
  expectedLoss: number;
  /** z-test vs controle (bicaudal). null no controle. */
  pValue: number | null;
}

const DRAWS = 20_000;

/**
 * Compara taxas de conversão (primeira = controle). Posterior Beta(1 + conv, 1 + visitantes − conv).
 */
export function compareRates(arms: ArmInput[], draws = DRAWS, seed = 7): ArmResult[] {
  const r = rng(seed);
  const k = arms.length;
  const samples = arms.map(() => new Float64Array(draws));
  for (let i = 0; i < draws; i++)
    for (let j = 0; j < k; j++) {
      const a = arms[j]!;
      samples[j]![i] = betaSample(1 + a.conversions, 1 + Math.max(0, a.visitors - a.conversions), r);
    }
  return summarize(
    samples,
    arms.map((a) => (a.visitors ? a.conversions / a.visitors : 0)),
    arms.map((a, j) => (j === 0 ? null : zTest(arms[0]!, a))),
  );
}

export interface MeanInput {
  n: number;
  mean: number;
  /** Variância amostral (n − 1). */
  variance: number;
}

/** Compara médias (receita por visitante) com posterior Normal(média, var/n) e teste de Welch. */
export function compareMeans(arms: MeanInput[], draws = DRAWS, seed = 11): ArmResult[] {
  const r = rng(seed);
  const samples = arms.map((a) => {
    const out = new Float64Array(draws);
    const sd = a.n > 1 ? Math.sqrt(a.variance / a.n) : Math.abs(a.mean) || 1;
    for (let i = 0; i < draws; i++) out[i] = a.mean + sd * gaussian(r);
    return out;
  });
  return summarize(
    samples,
    arms.map((a) => a.mean),
    arms.map((a, j) => (j === 0 ? null : welch(arms[0]!, a))),
  );
}

function summarize(samples: Float64Array[], point: number[], pValues: (number | null)[]): ArmResult[] {
  const k = samples.length;
  const draws = samples[0]?.length ?? 0;
  const wins = new Array<number>(k).fill(0);
  const beat = new Array<number>(k).fill(0);
  const loss = new Array<number>(k).fill(0);
  const lifts = samples.map(() => new Float64Array(draws));
  for (let i = 0; i < draws; i++) {
    let best = 0;
    let max = -Infinity;
    for (let j = 0; j < k; j++)
      if (samples[j]![i]! > max) {
        max = samples[j]![i]!;
        best = j;
      }
    wins[best]!++;
    const base = samples[0]![i]!;
    for (let j = 0; j < k; j++) {
      const v = samples[j]![i]!;
      loss[j]! += max - v;
      if (v > base) beat[j]!++;
      lifts[j]![i] = base ? (v - base) / Math.abs(base) : 0;
    }
  }
  return samples.map((s, j) => {
    const sorted = Float64Array.from(s).sort();
    const lift = Float64Array.from(lifts[j]!).sort();
    const isControl = j === 0;
    return {
      rate: point[j]!,
      rateLow: quantile(sorted, 0.025),
      rateHigh: quantile(sorted, 0.975),
      lift: isControl ? null : quantile(lift, 0.5),
      liftLow: isControl ? null : quantile(lift, 0.025),
      liftHigh: isControl ? null : quantile(lift, 0.975),
      probBeatControl: isControl ? null : beat[j]! / draws,
      probBest: wins[j]! / draws,
      expectedLoss: loss[j]! / draws,
      pValue: pValues[j]!,
    };
  });
}

/** z-test de duas proporções (bicaudal, variância combinada). */
export function zTest(a: ArmInput, b: ArmInput): number {
  if (!a.visitors || !b.visitors) return 1;
  const p1 = a.conversions / a.visitors;
  const p2 = b.conversions / b.visitors;
  const p = (a.conversions + b.conversions) / (a.visitors + b.visitors);
  const se = Math.sqrt(p * (1 - p) * (1 / a.visitors + 1 / b.visitors));
  if (!se) return 1;
  return 2 * (1 - normCdf(Math.abs(p2 - p1) / se));
}

/** Teste de Welch (aproximação normal: amostras de experimento são grandes). */
export function welch(a: MeanInput, b: MeanInput): number {
  if (a.n < 2 || b.n < 2) return 1;
  const se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  if (!se) return 1;
  return 2 * (1 - normCdf(Math.abs(b.mean - a.mean) / se));
}

/**
 * Sample ratio mismatch: a divisão observada de visitantes bate com os pesos configurados?
 * p < 0,01 indica problema na atribuição/coleta (o resultado do teste não é confiável).
 */
export function srm(observed: number[], weights: number[]): { pValue: number; mismatch: boolean } {
  const total = observed.reduce((s, x) => s + x, 0);
  const wsum = weights.reduce((s, x) => s + x, 0);
  if (!total || !wsum || observed.length < 2) return { pValue: 1, mismatch: false };
  let chi = 0;
  let df = -1;
  observed.forEach((o, i) => {
    const e = (total * weights[i]!) / wsum;
    if (e > 0) {
      chi += (o - e) ** 2 / e;
      df++;
    }
  });
  const pValue = df > 0 ? chiSquareSf(chi, df) : 1;
  return { pValue, mismatch: pValue < 0.01 };
}

/**
 * Visitantes POR VARIAÇÃO para detectar uma melhoria relativa `mde` sobre a taxa `baseline`
 * (bicaudal, α = 0,05, poder 0,8 por padrão).
 */
export function sampleSize(baseline: number, mde: number, alpha = 0.05, power = 0.8): number {
  const p1 = baseline;
  const p2 = baseline * (1 + mde);
  if (p1 <= 0 || p1 >= 1 || p2 <= 0 || p2 >= 1 || p1 === p2) return Infinity;
  const z = normInv(1 - alpha / 2) + normInv(power);
  return Math.ceil((z * z * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2);
}

/** Média e variância amostral. */
export function meanVar(values: number[]): MeanInput {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, variance: 0 };
  const mean = values.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, variance };
}

/** Veredito para a interface (limiares do produto). */
export type Verdict = 'winner' | 'loser' | 'leading' | 'inconclusive' | 'baseline';
export function verdict(r: ArmResult, minVisitors: number, visitors: number): Verdict {
  if (r.probBeatControl === null) return 'baseline';
  if (visitors < minVisitors) return 'inconclusive';
  if (r.probBeatControl >= 0.95) return 'winner';
  if (r.probBeatControl <= 0.05) return 'loser';
  return r.probBeatControl >= 0.75 ? 'leading' : 'inconclusive';
}
