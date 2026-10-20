import {
  compareMeans,
  compareRates,
  cuped,
  meanVar,
  msprt,
  rateInput,
  sampleSize,
  srm,
  verdict,
  type ArmResult,
  type Experiment,
  type TrackingEvent,
  type Verdict,
} from '@abtest/shared';
import { dayOf, daysBetween } from './overview';

/** Mínimo de visitantes por variação antes de declarar vencedor/perdedor. */
export const MIN_VISITORS = 100;
/** Melhoria relativa usada na estimativa de duração. */
export const DEFAULT_MDE = 0.1;
/** Nível do teste sequencial (bicaudal). */
export const SEQ_ALPHA = 0.05;

/** Teste sequencial de uma variação vs controle: p sempre válido e intervalo da melhoria relativa. */
export interface SequentialResult {
  pValue: number;
  liftLow: number | null;
  liftHigh: number | null;
}

export interface ArmRow extends ArmResult {
  variationId: string;
  visitors: number;
  conversions: number;
  revenue: number;
  /** Receita por visitante (só metas com receita). */
  rpv: number;
  verdict: Verdict;
  /** Só com teste sequencial ligado (null no controle). */
  sequential?: SequentialResult | null;
  /** Meta primária: a variação piora alguma meta de guarda (não é declarada vencedora). */
  guardrailViolated?: boolean;
}

export interface SectionReport {
  sectionId: string;
  name: string;
  /** Opções da seção somando todas as combinações que as contêm (a 1ª é o original = base). */
  options: (ArmResult & { optionId: string; name: string; visitors: number; conversions: number })[];
}

export interface GoalReport {
  /** MVT: efeito de cada opção, seção por seção. */
  sections?: SectionReport[];
  goalId: string;
  goalKey: string;
  primary: boolean;
  hasRevenue: boolean;
  arms: ArmRow[];
  /** Estatística de receita por visitante (se houver receita). */
  revenueArms:
    (ArmResult & { variationId: string; verdict: Verdict; sequential?: SequentialResult | null })[] | null;
  /** Meta de guarda (`stats.guardrails`). */
  guardrail?: boolean;
  /** CUPED aplicado: redução de variância obtida (0..1) na taxa e na receita por visitante. */
  cuped?: { reduction: number; revenueReduction: number | null };
}

/** Variação que piora uma meta de guarda com confiança (veredito "perdendo" na taxa ou na receita). */
export interface GuardrailViolation {
  goalId: string;
  goalKey: string;
  variationId: string;
  metric: 'rate' | 'revenue';
  lift: number | null;
}

/**
 * Estatística de uma métrica por visitante (`values[variação][visitante]`, a 1ª variação é o controle).
 * Sem CUPED: taxas com posterior Beta e receita com Normal (como sempre). Com CUPED (`x` = covariável na
 * mesma ordem): Y' ajustado e posterior Normal. Teste sequencial opcional; veredito de cada variação.
 */
function armStats(
  kind: 'rate' | 'mean',
  values: number[][],
  opts: { x?: number[][]; sequential: boolean; draws?: number },
) {
  const raw = values.map(meanVar);
  let means = raw;
  let stats: ArmResult[];
  let reduction: number | null = null;
  if (opts.x) {
    const c = cuped(values.flat(), opts.x.flat());
    let k = 0;
    means = values.map((vs) => meanVar(c.adjusted.slice(k, (k += vs.length))));
    reduction = c.reduction;
    // Taxa/média exibida continua a observada; intervalo, melhoria e chances vêm do estimador ajustado.
    stats = compareMeans(means, opts.draws).map((r, i) => ({ ...r, rate: raw[i]!.mean }));
  } else if (kind === 'rate') {
    const arms = values.map((vs) => ({ visitors: vs.length, conversions: vs.filter((v) => v > 0).length }));
    means = arms.map(rateInput);
    stats = compareRates(arms, opts.draws);
  } else stats = compareMeans(raw, opts.draws);
  return {
    reduction,
    arms: stats.map((r, i) => {
      const t = opts.sequential && i > 0 ? msprt(means[0]!, means[i]!, SEQ_ALPHA, DEFAULT_MDE) : undefined;
      const base = Math.abs(means[0]!.mean);
      return {
        ...r,
        verdict: verdict(r, MIN_VISITORS, Math.min(raw[0]!.n, raw[i]!.n), t, SEQ_ALPHA),
        ...(opts.sequential
          ? {
              sequential: t
                ? {
                    pValue: t.pValue,
                    liftLow: base && t.low !== null ? t.low / base : null,
                    liftHigh: base && t.high !== null ? t.high / base : null,
                  }
                : null,
            }
          : {}),
      };
    }),
  };
}

/**
 * Relatório de um experimento a partir dos eventos de exposição e conversão.
 * Visitante = quem teve exposição (contado uma vez, na primeira variação vista). Conversão = visitante único
 * que converteu a meta depois de exposto; receita = soma dos valores. QA fica de fora. `visitorFilter`
 * restringe a um subconjunto (ex.: dispositivo).
 */
export function experimentReport(
  exp: Experiment,
  events: TrackingEvent[],
  range: { from: Date; to: Date },
  visitorFilter?: (visitorId: string) => boolean,
  /** CUPED (`stats.cuped`): covariável pré-exposição por visitante (ausente = 0). Ver `preExposureActivity`. */
  covariate?: Map<string, number>,
  /** Sorteios do Monte Carlo (padrão 20 mil); o painel usa menos no recorte por dispositivo (CPU do Worker). */
  draws?: number,
) {
  const sequential = !!exp.stats?.sequential;
  const useCuped = !!exp.stats?.cuped && !!covariate;
  const vids = exp.variations.map((v) => v.id);
  const armOf = new Map<string, string>(); // visitante → variação
  const exposedAt = new Map<string, number>();
  const firstDay = new Map<string, string>(); // visitante → dia da exposição
  const conv = new Map<string, Map<string, number>>(); // meta → visitante → receita somada
  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  for (const e of sorted) {
    if (e.qa || (visitorFilter && !visitorFilter(e.visitorId))) continue;
    if (e.type === 'exposure') {
      if (!armOf.has(e.visitorId) && vids.includes(e.variationId)) {
        armOf.set(e.visitorId, e.variationId);
        exposedAt.set(e.visitorId, e.ts);
        firstDay.set(e.visitorId, dayOf(e.ts));
      }
    } else if (e.type === 'conversion') {
      const at = exposedAt.get(e.visitorId);
      if (at === undefined || e.ts < at) continue;
      let m = conv.get(e.goalId);
      if (!m) conv.set(e.goalId, (m = new Map()));
      m.set(e.visitorId, (m.get(e.visitorId) ?? 0) + (e.value ?? 0));
    }
  }

  const visitorsBy = new Map(vids.map((id) => [id, [] as string[]]));
  for (const [v, arm] of armOf) visitorsBy.get(arm)!.push(v);
  const visitors = vids.map((id) => visitorsBy.get(id)!.length);
  const total = visitors.reduce((s, n) => s + n, 0);

  const goals: GoalReport[] = exp.goals.map((g, gi) => {
    const m = conv.get(g.id) ?? new Map<string, number>();
    const perArm = vids.map((id) => {
      const vs = visitorsBy.get(id)!;
      const converted = vs.filter((v) => m.has(v));
      return {
        visitors: vs.length,
        conversions: converted.length,
        revenue: converted.reduce((s, v) => s + m.get(v)!, 0),
        values: vs.map((v) => m.get(v) ?? 0),
        hits: vs.map((v) => (m.has(v) ? 1 : 0)),
      };
    });
    const hasRevenue = perArm.some((a) => a.revenue !== 0);
    const x = useCuped ? vids.map((id) => visitorsBy.get(id)!.map((v) => covariate!.get(v) ?? 0)) : undefined;
    const rates = armStats(
      'rate',
      perArm.map((a) => a.hits),
      { x, sequential, draws },
    );
    const revenueStats = hasRevenue
      ? armStats(
          'mean',
          perArm.map((a) => a.values),
          { x, sequential, draws },
        )
      : null;
    const sections = exp.sections?.map((sec) => {
      const agg = sec.options.map((o) => {
        const idx = exp.variations
          .map((v, i) => (v.combination?.[sec.id] === o.id ? i : -1))
          .filter((i) => i >= 0);
        return {
          optionId: o.id,
          name: o.name,
          visitors: idx.reduce((s, i) => s + perArm[i]!.visitors, 0),
          conversions: idx.reduce((s, i) => s + perArm[i]!.conversions, 0),
        };
      });
      const stats = compareRates(agg);
      return { sectionId: sec.id, name: sec.name, options: agg.map((a, i) => ({ ...stats[i]!, ...a })) };
    });
    return {
      ...(sections ? { sections } : {}),
      goalId: g.id,
      goalKey: g.key,
      primary: gi === 0,
      hasRevenue,
      arms: rates.arms.map((r, i) => ({
        ...r,
        variationId: vids[i]!,
        visitors: perArm[i]!.visitors,
        conversions: perArm[i]!.conversions,
        revenue: perArm[i]!.revenue,
        rpv: perArm[i]!.visitors ? perArm[i]!.revenue / perArm[i]!.visitors : 0,
      })),
      revenueArms: revenueStats?.arms.map((r, i) => ({ ...r, variationId: vids[i]! })) ?? null,
      ...(useCuped
        ? { cuped: { reduction: rates.reduction ?? 0, revenueReduction: revenueStats?.reduction ?? null } }
        : {}),
    };
  });

  // Metas de guarda: variação "perdendo" (taxa ou receita) numa delas não pode ser declarada vencedora.
  const guardIds = new Set(exp.stats?.guardrails ?? []);
  const guardrails: GuardrailViolation[] = [];
  for (const g of goals) {
    if (g.primary || !guardIds.has(g.goalId)) continue;
    g.guardrail = true;
    g.arms.forEach((a, i) => {
      const rev = g.revenueArms?.[i];
      const hit: GuardrailViolation['metric'] | null =
        a.verdict === 'loser' ? 'rate' : rev?.verdict === 'loser' ? 'revenue' : null;
      if (hit)
        guardrails.push({
          goalId: g.goalId,
          goalKey: g.goalKey,
          variationId: a.variationId,
          metric: hit,
          lift: hit === 'rate' ? a.lift : rev!.lift,
        });
    });
  }
  const violated = new Set(guardrails.map((v) => v.variationId));
  for (const a of goals[0]?.arms ?? [])
    if (violated.has(a.variationId)) {
      a.guardrailViolated = true;
      if (a.verdict === 'winner') a.verdict = 'leading';
    }

  // Série diária acumulada (visitantes e taxa da meta primária) por variação.
  const primary = exp.goals[0] ? conv.get(exp.goals[0].id) : undefined;
  const days = daysBetween(range.from, range.to);
  const series = vids.map((id) => {
    let vis = 0;
    let cv = 0;
    const byDay = new Map<string, { v: number; c: number }>();
    for (const v of visitorsBy.get(id)!) {
      const d = firstDay.get(v)!;
      const x = byDay.get(d) ?? { v: 0, c: 0 };
      x.v++;
      if (primary?.has(v)) x.c++;
      byDay.set(d, x);
    }
    return {
      variationId: id,
      points: days.map((d) => {
        const x = byDay.get(d);
        vis += x?.v ?? 0;
        cv += x?.c ?? 0;
        return { day: d, visitors: vis, rate: vis ? cv / vis : 0 };
      }),
    };
  });

  // Duração estimada: amostra necessária para detectar +10% sobre a taxa atual do controle.
  const control = goals[0]?.arms[0];
  const needed = control && control.rate > 0 ? sampleSize(control.rate, DEFAULT_MDE) : null;
  const activeDays = new Set(firstDay.values()).size || 1;
  const perDay = total / activeDays;
  const remaining =
    needed && Number.isFinite(needed) && perDay > 0
      ? Math.max(0, Math.ceil((needed * vids.length - total) / perDay))
      : null;

  return {
    experimentId: exp.id,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    visitors: total,
    variations: exp.variations.map((v, i) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      visitors: visitors[i]!,
    })),
    goals,
    series,
    stats: { sequential, cuped: useCuped, alpha: SEQ_ALPHA },
    guardrails,
    srm: srm(
      visitors,
      exp.variations.map((v) => v.weight),
    ),
    estimate: {
      neededPerVariation: needed && Number.isFinite(needed) ? needed : null,
      daysRemaining: remaining,
      mde: DEFAULT_MDE,
    },
  };
}
export type ExperimentReport = ReturnType<typeof experimentReport>;

/** Dispositivo predominante de cada visitante (a partir das páginas vistas). */
export function deviceByVisitor(pageviews: TrackingEvent[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const e of pageviews) {
    if (e.type !== 'pageview') continue;
    const m = counts.get(e.visitorId) ?? new Map<string, number>();
    m.set(e.device, (m.get(e.device) ?? 0) + 1);
    counts.set(e.visitorId, m);
  }
  return new Map([...counts].map(([v, m]) => [v, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]]));
}

/** CUPED: janela da atividade anterior à exposição usada como covariável. */
export const CUPED_LOOKBACK_DAYS = 30;
/** Folga antes da exposição: a página vista da própria exposição (mesmo carregamento) não entra. */
export const CUPED_GAP_MS = 5_000;

/**
 * Covariável do CUPED: páginas vistas pelo visitante nos `CUPED_LOOKBACK_DAYS` dias antes da PRIMEIRA
 * exposição a este experimento (procurada também antes do período do relatório), até `CUPED_GAP_MS` antes
 * dela. Atividade anterior ao teste não é afetada pela variação, então o ajuste não cria viés. Visitante sem
 * histórico (novo) = 0, valor legítimo, não dado faltando. `events` = páginas vistas e exposições dos
 * visitantes do relatório.
 */
export function preExposureActivity(experimentId: string, events: TrackingEvent[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const e of events)
    if (e.type === 'exposure' && e.experimentId === experimentId && !e.qa)
      first.set(e.visitorId, Math.min(first.get(e.visitorId) ?? Infinity, e.ts));
  const out = new Map<string, number>();
  const lookback = CUPED_LOOKBACK_DAYS * 86_400_000;
  for (const e of events) {
    if (e.type !== 'pageview') continue;
    const at = first.get(e.visitorId);
    if (at !== undefined && e.ts < at - CUPED_GAP_MS && e.ts >= at - lookback)
      out.set(e.visitorId, (out.get(e.visitorId) ?? 0) + 1);
  }
  return out;
}
