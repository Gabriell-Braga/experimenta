import type { Funnel, FunnelStep, TrackingEvent } from '@abtest/shared';
import { matchUrl } from '@abtest/snippet/segment';
import { pagePath } from '../repo';

/** Destino de quem não viu outra página depois do passo. */
export const LEFT_SITE = '(saiu do site)';

const DAY = 86_400_000;

export const stepMatches = (s: FunnelStep, e: TrackingEvent) =>
  s.type === 'url'
    ? e.type === 'pageview' && matchUrl(s.url, e.url)
    : e.type === 'event' && e.name === s.event;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Funil por visitante, em ordem: o visitante entra no 1º passo e avança quando faz o próximo passo depois do
 * anterior, dentro de `windowDays` desde a entrada. Por passo: quantos chegaram, conversão vs anterior e vs
 * início, tempo mediano desde o passo anterior e, para quem parou ali, as próximas páginas visitadas
 * (análise de abandono). `visitorFilter` restringe (ex.: dispositivo).
 */
export function funnelReport(
  funnel: Funnel,
  events: TrackingEvent[],
  visitorFilter?: (v: string) => boolean,
) {
  const byVisitor = new Map<string, TrackingEvent[]>();
  for (const e of events) {
    if (e.qa || (e.type !== 'pageview' && e.type !== 'event')) continue;
    if (visitorFilter && !visitorFilter(e.visitorId)) continue;
    const l = byVisitor.get(e.visitorId);
    if (l) l.push(e);
    else byVisitor.set(e.visitorId, [e]);
  }
  const n = funnel.steps.length;
  const reached = new Array<number>(n).fill(0);
  const gaps = funnel.steps.map(() => [] as number[]);
  const next = funnel.steps.map(() => new Map<string, number>());
  const window = funnel.windowDays * DAY;

  for (const list of byVisitor.values()) {
    list.sort((a, b) => a.ts - b.ts);
    let step = 0;
    let start = 0;
    let last = 0;
    let lastIdx = -1;
    for (let i = 0; i < list.length && step < n; i++) {
      const e = list[i]!;
      if (step > 0 && e.ts - start > window) break;
      if (!stepMatches(funnel.steps[step]!, e)) continue;
      if (step === 0) start = e.ts;
      else gaps[step]!.push(e.ts - last);
      reached[step]!++;
      last = e.ts;
      lastIdx = i;
      step++;
    }
    // Parou antes do fim: para onde foi depois do último passo cumprido?
    if (step > 0 && step < n) {
      const after = list.slice(lastIdx + 1).find((e) => e.type === 'pageview');
      // Só o caminho: a mesma rota em outro domínio (ou com .html) é o mesmo destino.
      const where = after ? pagePath(after.url) : LEFT_SITE;
      const m = next[step - 1]!;
      m.set(where, (m.get(where) ?? 0) + 1);
    }
  }

  const first = reached[0] ?? 0;
  return {
    visitors: first,
    completed: reached[n - 1] ?? 0,
    conversion: first ? (reached[n - 1] ?? 0) / first : 0,
    steps: funnel.steps.map((s, i) => ({
      name: s.name,
      visitors: reached[i]!,
      fromPrevious: i === 0 ? 1 : reached[i - 1] ? reached[i]! / reached[i - 1]! : 0,
      fromStart: first ? reached[i]! / first : 0,
      dropoff: i < n - 1 ? reached[i]! - reached[i + 1]! : 0,
      medianMsFromPrevious: i === 0 ? null : median(gaps[i]!),
      dropoffNext: [...next[i]!.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([page, count]) => ({ page, count })),
    })),
  };
}
