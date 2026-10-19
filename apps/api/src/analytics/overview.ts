import type { TrackingEvent } from '@abtest/shared';
import { normalizePage } from '../repo';

/** Dia (UTC) de um timestamp: `2026-10-19`. */
export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Dias de `from` até `to` (inclusive), para séries sem buracos. */
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (
    let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    t <= to.getTime();
    t += 86_400_000
  )
    out.push(dayOf(t));
  return out;
}

const top = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/**
 * Visão geral dos dados coletados num período: totais, série diária, páginas e eventos mais frequentes.
 * Eventos de QA (?ab_force) ficam de fora.
 */
export function overview(list: TrackingEvent[], from: Date, to: Date) {
  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const byType = new Map<string, number>();
  const pages = new Map<string, number>();
  const names = new Map<string, number>();
  const devices = new Map<string, number>();
  const referrers = new Map<string, number>();
  const days = new Map(
    daysBetween(from, to).map((d) => [
      d,
      { day: d, pageviews: 0, events: 0, visitors: new Set<string>(), sessions: new Set<string>() },
    ]),
  );
  let revenue = 0;
  for (const e of list) {
    if (e.qa) continue;
    visitors.add(e.visitorId);
    if (e.sessionId) sessions.add(e.sessionId);
    inc(byType, e.type);
    const d = days.get(dayOf(e.ts));
    d?.visitors.add(e.visitorId);
    if (e.sessionId) d?.sessions.add(e.sessionId);
    if (e.type === 'pageview') {
      if (d) d.pageviews++;
      inc(pages, normalizePage(e.url));
      inc(devices, e.device);
      if (e.referrer) {
        try {
          const host = new URL(e.referrer).host;
          if (host !== new URL(e.url).host) inc(referrers, host);
        } catch {
          /* referrer inválido */
        }
      }
    } else if (e.type === 'event') {
      if (d) d.events++;
      inc(names, e.name);
      if (e.value) revenue += e.value;
    }
  }
  return {
    totals: {
      visitors: visitors.size,
      sessions: sessions.size,
      pageviews: byType.get('pageview') ?? 0,
      events: byType.get('event') ?? 0,
      conversions: byType.get('conversion') ?? 0,
      revenue,
    },
    byType: Object.fromEntries(byType),
    series: [...days.values()].map((d) => ({
      day: d.day,
      pageviews: d.pageviews,
      events: d.events,
      visitors: d.visitors.size,
      sessions: d.sessions.size,
    })),
    topPages: top(pages, 10),
    topEvents: top(names, 10),
    devices: Object.fromEntries(devices),
    referrers: top(referrers, 8),
  };
}
