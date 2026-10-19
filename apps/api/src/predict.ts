import {
  FEATURES,
  featurize,
  sigmoid,
  type PredictInput,
  type PropensityConfig,
  type PropensityModel,
  type TrackingEvent,
} from '@abtest/shared';
import { murmurhash3 } from '@abtest/snippet/bucket';
import type { Repo } from './repo';

const DAY = 86_400_000;
/** Mínimo de exemplos positivos para treinar (abaixo disso o modelo seria ruído). */
export const MIN_POSITIVES = 20;
/** Amostras por treino (as mais recentes); mantém o treino em poucos segundos no Worker. */
const MAX_SAMPLES = 20_000;
export const MODEL_KIND = 'propensity-model';

export interface TrainedModel extends PropensityModel {
  trainedAt: string;
  horizonDays: number;
  samples: number;
  /** Visitantes distintos que fizeram a meta. */
  positives: number;
  baseRate: number;
  /** Área sob a curva ROC no conjunto de teste (0,5 = acaso). */
  auc: number;
  /** Taxa real de conversão por décimo de score no teste (do maior score ao menor). */
  deciles: { rate: number; n: number; minScore: number }[];
  /** Peso de cada feature padronizada (quanto e em que direção ela pesa). */
  importance: { feature: string; weight: number }[];
}

/**
 * Exemplos: a cada página vista, o estado do visitante (como o snippet o veria naquela hora) e se ele fez a
 * meta nos `horizonDays` seguintes. Reconstrói o perfil a partir dos eventos.
 */
export function samples(events: TrackingEvent[], goal: string, horizonDays: number, now: number) {
  const byVisitor = new Map<string, TrackingEvent[]>();
  for (const e of events) {
    if (e.qa) continue;
    const l = byVisitor.get(e.visitorId);
    if (l) l.push(e);
    else byVisitor.set(e.visitorId, [e]);
  }
  const horizon = horizonDays * DAY;
  const out: { x: number[]; y: number; visitor: string; ts: number }[] = [];
  for (const [visitor, list] of byVisitor) {
    list.sort((a, b) => a.ts - b.ts);
    const goals = list.filter((e) => e.type === 'event' && e.name === goal).map((e) => e.ts);
    const p: PredictInput = { pv: 0, s: 0, ev: {}, f: list[0]!.ts, p: [] };
    let session: string | undefined;
    for (const e of list) {
      if (e.type === 'event') p.ev[e.name] = (p.ev[e.name] ?? 0) + 1;
      else if (e.type === 'identify' && e.userId) p.u = e.userId;
      else if (e.type === 'pageview') {
        p.pv++;
        if (e.sessionId !== session) {
          session = e.sessionId;
          p.s++;
        }
        try {
          const u = new URL(e.url);
          p.p = [...p.p!.filter((x) => x !== u.pathname), u.pathname].slice(-30);
          if (!p.t) {
            p.t = {};
            const src = u.searchParams.get('utm_source');
            if (src) p.t.utm_source = src;
            if (e.referrer) p.t.ref = new URL(e.referrer).host;
          }
        } catch {
          /* URL inválida */
        }
        // Sem horizonte completo ainda: não dá para saber o rótulo.
        if (e.ts + horizon > now) continue;
        const y = goals.some((g) => g > e.ts && g <= e.ts + horizon) ? 1 : 0;
        out.push({ x: featurize(p, e.device, goal, e.ts), y, visitor, ts: e.ts });
      }
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, MAX_SAMPLES);
}

/** AUC pelo método dos postos (Mann-Whitney). */
export function auc(scores: number[], ys: number[]): number {
  const idx = scores.map((s, i) => [s, ys[i]!] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j < idx.length && idx[j]![0] === idx[i]![0]) j++;
    const rank = (i + j + 1) / 2; // posto médio dos empates
    for (let k = i; k < j; k++)
      if (idx[k]![1]) {
        rankSum += rank;
        pos++;
      }
    i = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

/**
 * Regressão logística (gradiente em lote, L2) sobre features padronizadas; os pesos voltam para a escala
 * crua, que é o que o snippet calcula.
 */
export function fitLogistic(xs: number[][], ys: number[], iters = 400, lr = 0.5, l2 = 1e-3) {
  const d = xs[0]?.length ?? 0;
  const n = xs.length;
  const mu = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(0);
  for (const x of xs) for (let j = 0; j < d; j++) mu[j]! += x[j]! / n;
  for (const x of xs) for (let j = 0; j < d; j++) sd[j]! += (x[j]! - mu[j]!) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]!) || 1;
  const z = xs.map((x) => x.map((v, j) => (v - mu[j]!) / sd[j]!));
  const w = new Array<number>(d).fill(0);
  const rate = ys.reduce((s, y) => s + y, 0) / (n || 1);
  let b = Math.log((rate || 1e-6) / (1 - rate || 1e-6));
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let s = b;
      for (let j = 0; j < d; j++) s += w[j]! * z[i]![j]!;
      const err = sigmoid(s) - ys[i]!;
      gb += err;
      for (let j = 0; j < d; j++) gw[j]! += err * z[i]![j]!;
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < d; j++) w[j]! -= lr * (gw[j]! / n + l2 * w[j]!);
  }
  const raw = w.map((v, j) => v / sd[j]!);
  const rawB = b - w.reduce((s, v, j) => s + (v * mu[j]!) / sd[j]!, 0);
  return { w: raw, b: rawB, standardized: w };
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Treina e avalia (20% dos visitantes ficam de fora para teste). null se não houver positivos suficientes. */
export function trainPropensity(
  events: TrackingEvent[],
  cfg: PropensityConfig,
  now = Date.now(),
): TrainedModel | { error: string; positives: number; samples: number } {
  const all = samples(events, cfg.goal, cfg.horizonDays, now);
  // Visitantes distintos que fizeram a meta (cada visitante gera um exemplo por página vista).
  const positives = new Set(all.filter((s) => s.y).map((s) => s.visitor)).size;
  if (positives < MIN_POSITIVES)
    return {
      error: `poucos exemplos da meta (${positives}; mínimo ${MIN_POSITIVES})`,
      positives,
      samples: all.length,
    };
  const isTest = (v: string) => murmurhash3(`pred:${v}`) % 5 === 0;
  const train = all.filter((s) => !isTest(s.visitor));
  const test = all.filter((s) => isTest(s.visitor));
  const m = fitLogistic(
    train.map((s) => s.x),
    train.map((s) => s.y),
  );
  const model: PropensityModel = { goal: cfg.goal, w: m.w.map(r4), b: r4(m.b) };
  const evalSet = test.length >= 50 ? test : all;
  const scored = evalSet
    .map((s) => ({ p: sigmoid(model.b + s.x.reduce((acc, v, j) => acc + model.w[j]! * v, 0)), y: s.y }))
    .sort((a, b) => b.p - a.p);
  const deciles = Array.from({ length: 10 }, (_, k) => {
    const slice = scored.slice(
      Math.floor((k * scored.length) / 10),
      Math.floor(((k + 1) * scored.length) / 10),
    );
    return {
      n: slice.length,
      rate: slice.length ? slice.filter((s) => s.y).length / slice.length : 0,
      minScore: r4(slice.at(-1)?.p ?? 0),
    };
  });
  return {
    ...model,
    trainedAt: new Date(now).toISOString(),
    horizonDays: cfg.horizonDays,
    samples: all.length,
    positives,
    baseRate: all.filter((s) => s.y).length / all.length,
    auc: r4(
      auc(
        scored.map((s) => s.p),
        scored.map((s) => s.y),
      ),
    ),
    deciles,
    importance: FEATURES.map((feature, j) => ({ feature, weight: r4(m.standardized[j]!) })).sort(
      (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    ),
  };
}

/** Treina com os eventos dos últimos 90 dias e grava o modelo da conta (substitui o anterior). */
export async function retrainPropensity(repo: Repo, accountId: string, now = Date.now()) {
  const cfg = (await repo.listEntities<PropensityConfig>(accountId, 'propensity'))[0];
  if (!cfg?.data.enabled) return { error: 'analytics preditivo desligado' };
  const events = await repo.listEvents(accountId, {
    from: new Date(now - 90 * DAY),
    to: new Date(now),
    types: ['pageview', 'event', 'identify'],
  });
  const r = trainPropensity(events, cfg.data, now);
  if ('error' in r) return r;
  const prev = (await repo.listEntities<TrainedModel>(accountId, MODEL_KIND))[0];
  await repo.saveEntity(accountId, { id: prev?.id, kind: MODEL_KIND, name: cfg.data.goal, data: r });
  return r;
}
