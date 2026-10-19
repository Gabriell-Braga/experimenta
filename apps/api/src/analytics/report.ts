import {
  compareMeans,
  compareRates,
  meanVar,
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

export interface ArmRow extends ArmResult {
  variationId: string;
  visitors: number;
  conversions: number;
  revenue: number;
  /** Receita por visitante (só metas com receita). */
  rpv: number;
  verdict: Verdict;
}

export interface GoalReport {
  goalId: string;
  goalKey: string;
  primary: boolean;
  hasRevenue: boolean;
  arms: ArmRow[];
  /** Estatística de receita por visitante (se houver receita). */
  revenueArms: (ArmResult & { variationId: string; verdict: Verdict })[] | null;
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
) {
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
      const revenue = converted.reduce((s, v) => s + m.get(v)!, 0);
      return {
        visitors: vs.length,
        conversions: converted.length,
        revenue,
        values: vs.map((v) => m.get(v) ?? 0),
      };
    });
    const hasRevenue = perArm.some((a) => a.revenue !== 0);
    const rates = compareRates(perArm.map((a) => ({ visitors: a.visitors, conversions: a.conversions })));
    const revenueStats = hasRevenue ? compareMeans(perArm.map((a) => meanVar(a.values))) : null;
    return {
      goalId: g.id,
      goalKey: g.key,
      primary: gi === 0,
      hasRevenue,
      arms: rates.map((r, i) => ({
        ...r,
        variationId: vids[i]!,
        visitors: perArm[i]!.visitors,
        conversions: perArm[i]!.conversions,
        revenue: perArm[i]!.revenue,
        rpv: perArm[i]!.visitors ? perArm[i]!.revenue / perArm[i]!.visitors : 0,
        verdict: verdict(r, MIN_VISITORS, Math.min(perArm[0]!.visitors, perArm[i]!.visitors)),
      })),
      revenueArms:
        revenueStats?.map((r, i) => ({
          ...r,
          variationId: vids[i]!,
          verdict: verdict(r, MIN_VISITORS, Math.min(perArm[0]!.visitors, perArm[i]!.visitors)),
        })) ?? null,
    };
  });

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
