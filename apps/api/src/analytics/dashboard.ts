import type { Experiment, TrackingEvent } from '@abtest/shared';
import { engageReport } from './engage';
import { formsReport } from './forms';
import { overview } from './overview';
import { pagesReport } from './pages';
import { buildProfiles, crossDevice } from './profiles';
import { experimentReport } from './report';

/** Tipos de evento que o painel lê (sem `click`/`move`, os mais volumosos). */
export const DASHBOARD_TYPES = [
  'pageview',
  'event',
  'conversion',
  'exposure',
  'identify',
  'frustration',
  'scroll',
  'form',
  'engage',
  'survey',
] as const;

/** Variação relativa vs período anterior (null sem base). */
const delta = (cur: number, prev: number) => (prev ? (cur - prev) / prev : null);

/** Resumo de um experimento em execução: líder na meta primária, SRM e dias restantes. */
export function experimentSummary(exp: Experiment, events: TrackingEvent[], range: { from: Date; to: Date }) {
  const r = experimentReport(exp, events, range);
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
  };
}

/**
 * Painel geral: KPIs de todos os módulos no período, com comparação ao período anterior de mesma duração.
 * `prev` = eventos do período anterior; `running` = experimentos em execução (com os próprios eventos).
 */
export function dashboard(
  cur: TrackingEvent[],
  prev: TrackingEvent[],
  range: { from: Date; to: Date },
  running: Experiment[],
) {
  const o = overview(cur, range.from, range.to);
  const p = overview(prev, range.from, range.from).totals;
  const t = o.totals;
  const pages = pagesReport(cur);
  const scrolls = pages.filter((x) => x.avgScroll !== null);
  const forms = formsReport(cur);
  const engage = engageReport(cur);
  const sum = (xs: { [k: string]: unknown }[], k: string) =>
    xs.reduce((s, x) => s + ((x[k] as number) ?? 0), 0);
  const formTotals = {
    landed: sum(forms, 'landed'),
    interacted: sum(forms, 'interacted'),
    submitted: sum(forms, 'submitted'),
  };
  const nps = cur.filter((e) => e.type === 'survey' && !e.qa);
  const cd = crossDevice(buildProfiles(cur).values());
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    traffic: {
      ...t,
      deltas: {
        visitors: delta(t.visitors, p.visitors),
        sessions: delta(t.sessions, p.sessions),
        pageviews: delta(t.pageviews, p.pageviews),
        conversions: delta(t.conversions, p.conversions),
        revenue: delta(t.revenue, p.revenue),
      },
      series: o.series.map((d) => ({ day: d.day, visitors: d.visitors })),
      devices: o.devices,
    },
    experiments: running.map((exp) =>
      experimentSummary(
        exp,
        cur.filter((e) => 'experimentId' in e && e.experimentId === exp.id),
        range,
      ),
    ),
    behavior: {
      rage: sum(pages, 'rage'),
      dead: sum(pages, 'dead'),
      avgScroll: scrolls.length
        ? Math.round(scrolls.reduce((s, x) => s + x.avgScroll!, 0) / scrolls.length)
        : null,
      worstPage: [...pages].sort((a, b) => b.rage + b.dead - (a.rage + a.dead))[0]?.page ?? null,
    },
    forms: {
      ...formTotals,
      completion: formTotals.interacted ? formTotals.submitted / formTotals.interacted : null,
    },
    engage: {
      views: sum(engage, 'views'),
      clicks: sum(engage, 'clicks'),
      submits: sum(engage, 'submits'),
      surveyResponses: nps.length,
    },
    profiles: { identified: cd.identified, multiDevice: cd.multiDevice },
  };
}
export type Dashboard = ReturnType<typeof dashboard>;
