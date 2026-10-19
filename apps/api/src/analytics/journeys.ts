import type { TrackingEvent } from '@abtest/shared';
import { normalizePage } from '../repo';

const EXIT = '(saída)';
const ENTRY = '(entrada)';

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

/**
 * Jornadas a partir das páginas vistas, por sessão: páginas de entrada e de saída, caminhos mais comuns
 * (primeiras `depth` páginas, sem repetir recargas) e, para `focus`, de onde os visitantes vêm e para onde vão.
 */
export function journeysReport(
  events: TrackingEvent[],
  o: { focus?: string; depth?: number; device?: string } = {},
) {
  const depth = o.depth ?? 4;
  const sessions = new Map<string, { ts: number; page: string }[]>();
  for (const e of events) {
    if (e.type !== 'pageview' || e.qa || (o.device && e.device !== o.device)) continue;
    const key = e.sessionId ?? e.visitorId;
    const l = sessions.get(key) ?? [];
    l.push({ ts: e.ts, page: normalizePage(e.url) });
    sessions.set(key, l);
  }
  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  const paths = new Map<string, number>();
  const prev = new Map<string, number>();
  const next = new Map<string, number>();
  let focusViews = 0;
  let bounces = 0;
  for (const raw of sessions.values()) {
    raw.sort((a, b) => a.ts - b.ts);
    // Recarregar a mesma página não é um passo da jornada.
    const seq = raw.map((p) => p.page).filter((p, i, a) => i === 0 || a[i - 1] !== p);
    inc(entries, seq[0]!);
    inc(exits, seq.at(-1)!);
    if (seq.length === 1) bounces++;
    inc(paths, seq.slice(0, depth).join(' → '));
    if (o.focus)
      seq.forEach((p, i) => {
        if (p !== o.focus) return;
        focusViews++;
        inc(prev, i ? seq[i - 1]! : ENTRY);
        inc(next, i < seq.length - 1 ? seq[i + 1]! : EXIT);
      });
  }
  return {
    sessions: sessions.size,
    bounceRate: sessions.size ? bounces / sessions.size : 0,
    entries: top(entries, 10),
    exits: top(exits, 10),
    paths: top(paths, 15).map((p) => ({ steps: p.key.split(' → '), count: p.count })),
    focus: o.focus ? { page: o.focus, views: focusViews, previous: top(prev, 8), next: top(next, 8) } : null,
  };
}
