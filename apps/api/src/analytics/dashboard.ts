import { remainingDuration, type Experiment, type TrackingEvent } from '@abtest/shared';
import { sumDays, type DayStats } from './daily';
import type { Insight } from './insights';
import { buildProfiles, crossDevice } from './profiles';
import type { experimentReport } from './report';

export { DASHBOARD_TYPES } from './daily';

/** Variação relativa vs período anterior (null sem base). */
const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : null);

/** Resumo de um experimento em execução: líder na meta primária, SRM e dias restantes. */
export function experimentSummary(exp: Experiment, r: ReturnType<typeof experimentReport>) {
  const goal = r.goals.find((g) => g.primary) ?? r.goals[0];
  const challengers = goal?.arms.slice(1) ?? [];
  const best = challengers.reduce<(typeof challengers)[number] | null>(
    (b, a) => (!b || a.probBest > b.probBest ? a : b),
    null,
  );
  const v = best && exp.variations.find((x) => x.id === best.variationId);
  return {
    id: exp.id,
    name: exp.name,
    type: exp.type ?? 'ab',
    visitors: r.visitors,
    goal: goal?.goalKey ?? null,
    leader:
      best && v
        ? { name: v.name, lift: best.lift, probBeatControl: best.probBeatControl, verdict: best.verdict }
        : null,
    srm: r.srm.mismatch,
    daysRemaining: r.estimate.daysRemaining,
    /** Acima de 8 semanas: não esperar concluir (encerrar ou redesenhar). */
    duration: remainingDuration(r.estimate.daysRemaining),
  };
}

/**
 * Bloco principal do painel a partir dos agregados diários: tráfego (com variação vs período anterior de mesma
 * duração), comportamento, formulários e engajamento. `unique` = únicos do período e do anterior (contados no banco);
 * dia sem agregado conta zero e entra em `pendingDays` (no período anterior, desliga as variações).
 */
export function dashboardSummary(input: {
  days: string[];
  prevDays: string[];
  stats: Map<string, DayStats>;
  unique: { cur: { visitors: number; sessions: number }; prev: { visitors: number; sessions: number } };
  to: Date;
}) {
  const { days, prevDays, stats, unique } = input;
  const c = sumDays(days.flatMap((d) => stats.get(d) ?? []));
  const prevComplete = prevDays.every((d) => stats.has(d));
  const p = sumDays(prevDays.flatMap((d) => stats.get(d) ?? []));
  const d = (cur: number, prev: number) => (prevComplete ? delta(cur, prev) : null);
  const scrolls = c.pages.filter((x) => x.scrolls);
  return {
    from: new Date(`${days[0]}T00:00:00Z`).toISOString(),
    to: input.to.toISOString(),
    pendingDays: days.filter((x) => !stats.has(x)).length,
    traffic: {
      visitors: unique.cur.visitors,
      sessions: unique.cur.sessions,
      pageviews: c.pageviews,
      events: c.events,
      conversions: c.conversions,
      revenue: c.revenue,
      deltas: {
        visitors: d(unique.cur.visitors, unique.prev.visitors),
        sessions: d(unique.cur.sessions, unique.prev.sessions),
        pageviews: d(c.pageviews, p.pageviews),
        conversions: d(c.conversions, p.conversions),
        revenue: d(c.revenue, p.revenue),
      },
      series: days.map((day) => ({ day, visitors: stats.get(day)?.visitors ?? 0 })),
      devices: c.devices,
    },
    behavior: {
      rage: c.rage,
      dead: c.dead,
      avgScroll: scrolls.length
        ? Math.round(scrolls.reduce((s, x) => s + x.scrollSum / x.scrolls, 0) / scrolls.length)
        : null,
      worstPage:
        [...c.pages].filter((x) => x.rage + x.dead).sort((a, b) => b.rage + b.dead - (a.rage + a.dead))[0]
          ?.page ?? null,
    },
    forms: {
      ...c.forms,
      completion: c.forms.interacted ? c.forms.submitted / c.forms.interacted : null,
    },
    engage: c.engage,
  };
}

/** Perfis identificados no período e quantos usam mais de um dispositivo (`identify` + páginas vistas deles). */
export function profilesSummary(events: TrackingEvent[]) {
  const cd = crossDevice(buildProfiles(events).values());
  return { identified: cd.identified, multiDevice: cd.multiDevice };
}

/** Painel inteiro (as ideias de IA leem tudo junto; a tela pede bloco a bloco). */
export type Dashboard = ReturnType<typeof dashboardSummary> & {
  experiments: ReturnType<typeof experimentSummary>[];
  insights: Insight[];
  profiles: ReturnType<typeof profilesSummary>;
};
