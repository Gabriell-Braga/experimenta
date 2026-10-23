import type { TrackingEvent } from '@abtest/shared';
import type { Repo } from '../repo';
import { engageReport } from './engage';
import { formsReport } from './forms';
import { daysBetween, overview } from './overview';
import { pagesReport } from './pages';

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

/**
 * Agregados diários do painel (tarefa 20.1, D-096). O painel de 30/90 dias lia todos os eventos crus do período
 * (e do anterior) e estourava os 10 ms de CPU do Worker grátis; agora soma uma linha por dia (`daily_stats`) e só
 * lê crus os dias que ainda não têm linha (hoje, normalmente).
 */
export interface DayStats {
  /** Únicos do dia (a série do gráfico); os únicos do período vêm de `repo.countDistinct`. */
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  conversions: number;
  revenue: number;
  devices: Record<string, number>;
  rage: number;
  dead: number;
  /** Páginas mais vistas e mais frustrantes do dia (scroll médio e pior página). */
  pages: {
    page: string;
    pageviews: number;
    rage: number;
    dead: number;
    scrollSum: number;
    scrolls: number;
  }[];
  forms: { landed: number; interacted: number; submitted: number };
  engage: { views: number; clicks: number; submits: number; surveyResponses: number };
}

const DAY = 86_400_000;
/** Dia fechado há pelo menos 1 h vira linha; antes disso é recalculado do cru (eventos atrasados do beacon). */
const SETTLE = 3_600_000;
// ponytail: só 20 páginas mais vistas + 5 mais frustrantes por dia; scroll médio e pior página são aproximados
// em sites com muitas URLs. Tabela por página se precisar do exato.
const TOP_PAGES = 20;
const TOP_FRUSTRATION = 5;

export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/** Agregado de um dia a partir dos eventos crus dele. */
export function dayStats(events: TrackingEvent[], day: string): DayStats {
  const t = dayStart(day);
  const o = overview(events, new Date(t), new Date(t + DAY - 1));
  const pages = pagesReport(events);
  const keep = new Set([
    ...pages.slice(0, TOP_PAGES),
    ...[...pages].sort((a, b) => b.rage + b.dead - (a.rage + a.dead)).slice(0, TOP_FRUSTRATION),
  ]);
  const forms = formsReport(events);
  const engage = engageReport(events);
  return {
    visitors: o.totals.visitors,
    sessions: o.totals.sessions,
    pageviews: o.totals.pageviews,
    events: o.totals.events,
    conversions: o.totals.conversions,
    revenue: o.totals.revenue,
    devices: o.devices,
    rage: sum(pages, (p) => p.rage),
    dead: sum(pages, (p) => p.dead),
    pages: [...keep].map((p) => ({
      page: p.page,
      pageviews: p.pageviews,
      rage: p.rage,
      dead: p.dead,
      scrollSum: (p.avgScroll ?? 0) * p.scrolls,
      scrolls: p.scrolls,
    })),
    forms: {
      landed: sum(forms, (f) => f.landed),
      interacted: sum(forms, (f) => f.interacted),
      submitted: sum(forms, (f) => f.submitted),
    },
    engage: {
      views: sum(engage, (e) => e.views),
      clicks: sum(engage, (e) => e.clicks),
      submits: sum(engage, (e) => e.submits),
      surveyResponses: events.filter((e) => e.type === 'survey' && !e.qa).length,
    },
  };
}

/** Soma de vários dias (únicos somados = visitantes-dia; o painel troca pelos únicos do período). */
export function sumDays(list: DayStats[]): DayStats {
  const pages = new Map<string, DayStats['pages'][number]>();
  const devices: Record<string, number> = {};
  for (const d of list) {
    for (const [k, v] of Object.entries(d.devices)) devices[k] = (devices[k] ?? 0) + v;
    for (const p of d.pages) {
      const x = pages.get(p.page);
      if (!x) pages.set(p.page, { ...p });
      else for (const k of ['pageviews', 'rage', 'dead', 'scrollSum', 'scrolls'] as const) x[k] += p[k];
    }
  }
  const total = (f: (d: DayStats) => number) => sum(list, f);
  return {
    visitors: total((d) => d.visitors),
    sessions: total((d) => d.sessions),
    pageviews: total((d) => d.pageviews),
    events: total((d) => d.events),
    conversions: total((d) => d.conversions),
    revenue: total((d) => d.revenue),
    devices,
    rage: total((d) => d.rage),
    dead: total((d) => d.dead),
    pages: [...pages.values()],
    forms: {
      landed: total((d) => d.forms.landed),
      interacted: total((d) => d.forms.interacted),
      submitted: total((d) => d.forms.submitted),
    },
    engage: {
      views: total((d) => d.engage.views),
      clicks: total((d) => d.engage.clicks),
      submits: total((d) => d.engage.submits),
      surveyResponses: total((d) => d.engage.surveyResponses),
    },
  };
}

/**
 * Agregados dos `days` pedidos: lê as linhas salvas e calcula do cru até `max` dias que faltam (os mais recentes),
 * gravando os já fechados. `missing` = dias que continuam sem dado (o job de hora em hora completa).
 */
export async function ensureDays(
  repo: Repo,
  accountId: string,
  days: string[],
  max: number,
  now = Date.now(),
) {
  const stats = new Map<string, DayStats>();
  if (!days.length) return { stats, missing: [] };
  for (const r of await repo.listDailyStats<DayStats>(accountId, days[0]!, days.at(-1)!))
    stats.set(r.day, r.data);
  const missing = days.filter((d) => !stats.has(d));
  const todo = missing.slice(-max);
  const computed = await Promise.all(
    todo.map(async (day) => {
      const t = dayStart(day);
      const list = await repo.listEvents(accountId, {
        from: new Date(t),
        to: new Date(t + DAY - 1),
        types: [...DASHBOARD_TYPES],
      });
      return { day, data: dayStats(list, day) };
    }),
  );
  for (const c of computed) stats.set(c.day, c.data);
  await repo.saveDailyStats(
    accountId,
    computed.filter((c) => dayStart(c.day) + DAY + SETTLE <= now),
  );
  return { stats, missing: missing.slice(0, missing.length - todo.length) };
}

/** Dias que o job mantém: 180 (painel de 90 dias + o período anterior). */
const KEEP_DAYS = 180;
/** Dias calculados por conta a cada hora (CPU do cron no plano grátis); backfill de 180 dias em ~2 dias. */
const JOB_DAYS = 4;

/** Job de hora em hora: grava os dias fechados que faltam, do mais recente para trás. */
export async function dailyStatsJob(repo: Repo, now = Date.now()) {
  const days = daysBetween(new Date(now - KEEP_DAYS * DAY), new Date(now - DAY)).filter(
    (d) => dayStart(d) + DAY + SETTLE <= now,
  );
  for (const accountId of await repo.listAccountIds())
    await ensureDays(repo, accountId, days, JOB_DAYS, now).catch((e) =>
      console.error('[daily-stats]', accountId, e),
    );
}
