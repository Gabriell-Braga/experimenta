import type { TrackingEvent } from '@abtest/shared';
import { dayOf } from './overview';

const DAY = 86_400_000;

/** Início do período (UTC) do timestamp: dia ou semana (segunda-feira). */
export function bucketStart(ts: number, unit: 'day' | 'week'): number {
  const d = new Date(ts);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (unit === 'day') return day;
  const dow = (new Date(day).getUTCDay() + 6) % 7; // 0 = segunda
  return day - dow * DAY;
}

/**
 * Coortes por data da primeira visita (no período carregado). Para cada coorte e período N depois da entrada:
 * - `retention`: % dos visitantes da coorte com alguma página vista no período N;
 * - `event`: % acumulado que fez o evento `event` (ou qualquer conversão, se vazio) até o período N.
 */
export function cohortsReport(
  events: TrackingEvent[],
  o: { unit: 'day' | 'week'; metric: 'retention' | 'event'; event?: string; periods?: number; now?: number },
) {
  const step = o.unit === 'day' ? DAY : 7 * DAY;
  const periods = o.periods ?? (o.unit === 'day' ? 14 : 8);
  const first = new Map<string, number>();
  const active = new Map<string, Set<number>>(); // visitante → índices de período ativos (relativos)
  const did = new Map<string, number>(); // visitante → 1º período em que fez o evento
  const sorted = [...events].filter((e) => !e.qa).sort((a, b) => a.ts - b.ts);
  for (const e of sorted)
    if (e.type === 'pageview' && !first.has(e.visitorId)) first.set(e.visitorId, bucketStart(e.ts, o.unit));
  for (const e of sorted) {
    const f = first.get(e.visitorId);
    if (f === undefined) continue;
    const idx = Math.floor((bucketStart(e.ts, o.unit) - f) / step);
    if (idx < 0) continue;
    if (e.type === 'pageview') {
      const s = active.get(e.visitorId) ?? new Set<number>();
      s.add(idx);
      active.set(e.visitorId, s);
    }
    const hit = o.event ? e.type === 'event' && e.name === o.event : e.type === 'conversion';
    if (hit && !did.has(e.visitorId)) did.set(e.visitorId, idx);
  }
  const cohorts = new Map<number, string[]>();
  for (const [v, f] of first) cohorts.set(f, [...(cohorts.get(f) ?? []), v]);
  const nowBucket = bucketStart(o.now ?? Date.now(), o.unit);
  return {
    unit: o.unit,
    metric: o.metric,
    periods,
    cohorts: [...cohorts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, vs]) => {
        // Períodos que já aconteceram para esta coorte (os futuros ficam null).
        const elapsed = Math.floor((nowBucket - start) / step);
        return {
          start: dayOf(start),
          size: vs.length,
          values: Array.from({ length: periods }, (_, n) => {
            if (n > elapsed) return null;
            const count =
              o.metric === 'retention'
                ? vs.filter((v) => active.get(v)?.has(n)).length
                : vs.filter((v) => (did.get(v) ?? Infinity) <= n).length;
            return { count, rate: vs.length ? count / vs.length : 0 };
          }),
        };
      }),
  };
}
