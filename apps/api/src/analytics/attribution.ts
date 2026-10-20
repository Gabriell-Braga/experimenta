import type { TrackingEvent } from '@abtest/shared';
import type { Repo } from '../repo';

/**
 * Receita por canal (D-080): cada conversão é creditada inteira a uma visita com origem ("toque"), no modelo
 * de primeiro toque e no de último toque não direto. Tudo derivado das páginas vistas já coletadas (URL com
 * UTMs e referrer); o snippet não muda.
 */
export const CHANNELS = ['direct', 'organic', 'paid', 'social', 'email', 'referral', 'campaign'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Janela de atribuição: só visitas até 30 dias antes da conversão contam. */
export const ATTRIBUTION_WINDOW_DAYS = 30;
const WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 86_400_000;
const SESSION_GAP_MS = 30 * 60_000;

export interface Touch {
  ts: number;
  channel: Channel;
  source: string;
  campaign: string;
}

export const DIRECT_SOURCE = '(direto)';
export const NO_CAMPAIGN = '(sem campanha)';
const DIRECT: Omit<Touch, 'ts'> = { channel: 'direct', source: DIRECT_SOURCE, campaign: NO_CAMPAIGN };

const PAID_MEDIUM =
  /^(cpc|ppc|cpm|cpv|cpa|paid|paid[-_ ]?(search|social|media)|display|banner|retargeting|remarketing|ads?)$/;
const EMAIL = /^(e[-_ ]?mail|newsletter)$/;
const SOCIAL_MEDIUM = /^(social|social[-_ ]?(network|media)|sm|organic[-_ ]?social)$/;
const SOCIAL_SOURCE =
  /^(facebook|fb|instagram|ig|twitter|x|linkedin|tiktok|youtube|pinterest|reddit|whatsapp|threads|telegram|kwai)$/;
/** Ids de clique de anúncio (o `fbclid` vem também em links orgânicos do Facebook, então não conta). */
const CLICK_IDS: [string, string][] = [
  ['gclid', 'google'],
  ['gbraid', 'google'],
  ['wbraid', 'google'],
  ['dclid', 'google'],
  ['msclkid', 'bing'],
];
const SEARCH_HOST = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|naver|ask)(\.[a-z]{2,3}){1,2}$/;
const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  't.co',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'lnkd.in',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'pinterest.com',
  'reddit.com',
  'whatsapp.com',
  'wa.me',
  'threads.net',
  't.me',
  'telegram.org',
  'kwai.com',
];
const EMAIL_HOSTS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.uol.com.br',
  'mail.proton.me',
];
const hostIn = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
const bare = (host: string) => host.replace(/^www\./, '');

/**
 * Origem de uma página vista. `null` = navegação interna sem campanha (não é um toque novo).
 * Ordem: UTM (pelo `utm_medium`, depois pelo `utm_source`) → id de clique de anúncio → referrer externo →
 * direto. Referrer do próprio site conta como direto quando abre uma visita.
 */
export function classify(url: string, referrer?: string): Omit<Touch, 'ts'> | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return DIRECT;
  }
  const q = (k: string) => u.searchParams.get(k)?.trim().slice(0, 100) || '';
  const medium = q('utm_medium').toLowerCase();
  const utmSource = q('utm_source');
  const campaign = q('utm_campaign') || NO_CAMPAIGN;
  const click = CLICK_IDS.find(([k]) => u.searchParams.has(k));
  if (utmSource || medium || q('utm_campaign')) {
    const s = utmSource.toLowerCase();
    const channel: Channel =
      PAID_MEDIUM.test(medium) || (!medium && click)
        ? 'paid'
        : EMAIL.test(medium) || EMAIL.test(s)
          ? 'email'
          : SOCIAL_MEDIUM.test(medium) || (!medium && SOCIAL_SOURCE.test(s))
            ? 'social'
            : medium === 'organic'
              ? 'organic'
              : medium === 'referral'
                ? 'referral'
                : 'campaign';
    return { channel, source: utmSource || click?.[1] || '(sem origem)', campaign };
  }
  if (click) return { channel: 'paid', source: click[1], campaign };
  let ref: URL | null = null;
  try {
    ref = referrer ? new URL(referrer) : null;
  } catch {
    /* referrer inválido = sem referrer */
  }
  if (!ref) return DIRECT;
  const host = bare(ref.hostname.toLowerCase());
  if (host === bare(u.hostname.toLowerCase())) return null;
  const channel: Channel = hostIn(host, EMAIL_HOSTS)
    ? 'email'
    : SEARCH_HOST.test(host)
      ? 'organic'
      : hostIn(host, SOCIAL_HOSTS)
        ? 'social'
        : 'referral';
  return { channel, source: host, campaign };
}

const hasCampaign = (url: string) => /[?&](utm_[a-z]+|gclid|gbraid|wbraid|dclid|msclkid)=/.test(url);

/**
 * Toques de cada visitante, em ordem de tempo. Toque = 1ª página de cada visita (sessão; sem `sessionId`,
 * 30 min sem páginas) ou página no meio da visita que chega com UTM/id de clique. Referrer externo no meio
 * da visita NÃO abre toque (volta do gateway de pagamento não rouba a venda). Espera páginas em ordem de `ts`.
 */
export function touchesByVisitor(events: TrackingEvent[]): Map<string, Touch[]> {
  const out = new Map<string, Touch[]>();
  const last = new Map<string, { ts: number; sessionId?: string }>();
  for (const e of events) {
    if (e.type !== 'pageview' || e.qa) continue;
    const prev = last.get(e.visitorId);
    last.set(e.visitorId, { ts: e.ts, sessionId: e.sessionId });
    const newVisit =
      !prev || (e.sessionId ? e.sessionId !== prev.sessionId : e.ts - prev.ts > SESSION_GAP_MS);
    if (!newVisit && !hasCampaign(e.url)) continue;
    const t = classify(e.url, e.referrer) ?? (newVisit ? DIRECT : null);
    if (!t) continue;
    const list = out.get(e.visitorId) ?? [];
    list.push({ ts: e.ts, ...t });
    out.set(e.visitorId, list);
  }
  return out;
}

export interface Conversion {
  visitorId: string;
  ts: number;
  value: number;
  /** Índice da variação (0 fora de experimento). */
  arm: number;
}

/** Primeiro toque e último toque não direto (sem nenhum: o último direto) dentro da janela. */
export function pickTouches(touches: Touch[] | undefined, ts: number): { first: Touch; last: Touch } {
  let first: Touch | undefined;
  let last: Touch | undefined;
  let lastAny: Touch | undefined;
  for (const t of touches ?? []) {
    if (t.ts > ts) break;
    if (t.ts < ts - WINDOW_MS) continue;
    first ??= t;
    lastAny = t;
    if (t.channel !== 'direct') last = t;
  }
  const none = { ts, ...DIRECT };
  return { first: first ?? none, last: last ?? lastAny ?? none };
}

export interface AttributionRow {
  key: string;
  /** Canal da linha (nas linhas de origem e campanha: o canal mais comum dela). */
  channel: Channel;
  /** Por variação (uma posição fora de experimento). */
  conversions: number[];
  revenue: number[];
}
type Dim = 'channel' | 'source' | 'campaign';
export type AttributionModel = Record<Dim, AttributionRow[]>;

/** Conversões e receita por canal, origem e campanha nos dois modelos. O(conversões × toques do visitante). */
export function attribute(conversions: Conversion[], touches: Map<string, Touch[]>, arms = 1) {
  const blank = () =>
    ({ channel: new Map(), source: new Map(), campaign: new Map() }) as Record<
      Dim,
      Map<string, AttributionRow & { votes: Map<Channel, number> }>
    >;
  const models = { first: blank(), last: blank() };
  const add = (m: ReturnType<typeof blank>, t: Touch, c: Conversion) => {
    for (const dim of ['channel', 'source', 'campaign'] as const) {
      const key = dim === 'channel' ? t.channel : t[dim];
      let row = m[dim].get(key);
      if (!row) {
        row = {
          key,
          channel: t.channel,
          conversions: Array<number>(arms).fill(0),
          revenue: Array<number>(arms).fill(0),
          votes: new Map(),
        };
        m[dim].set(key, row);
      }
      row.conversions[c.arm]! += 1;
      row.revenue[c.arm]! += c.value;
      row.votes.set(t.channel, (row.votes.get(t.channel) ?? 0) + 1);
    }
  };
  for (const c of conversions) {
    const { first, last } = pickTouches(touches.get(c.visitorId), c.ts);
    add(models.first, first, c);
    add(models.last, last, c);
  }
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const rows = (m: ReturnType<typeof blank>): AttributionModel => {
    const list = (dim: Dim) =>
      [...m[dim].values()]
        .map(({ votes, ...r }) => ({
          ...r,
          channel: [...votes].sort((a, b) => b[1] - a[1])[0]![0],
          revenue: r.revenue.map((x) => Math.round(x * 100) / 100),
        }))
        .sort((a, b) => sum(b.revenue) - sum(a.revenue) || sum(b.conversions) - sum(a.conversions));
    return { channel: list('channel'), source: list('source'), campaign: list('campaign') };
  };
  return {
    windowDays: ATTRIBUTION_WINDOW_DAYS,
    conversions: conversions.length,
    revenue: Math.round(sum(conversions.map((c) => c.value)) * 100) / 100,
    first: rows(models.first),
    last: rows(models.last),
  };
}
export type Attribution = ReturnType<typeof attribute>;

/** Conversões do painel: eventos customizados (todos com valor, ou só os de um nome) e os nomes vistos. */
export function eventConversions(events: TrackingEvent[], name?: string) {
  const names = new Map<string, number>();
  const list: Conversion[] = [];
  for (const e of events) {
    if (e.type !== 'event' || e.qa) continue;
    names.set(e.name, (names.get(e.name) ?? 0) + 1);
    if (name ? e.name === name : (e.value ?? 0) > 0)
      list.push({ visitorId: e.visitorId, ts: e.ts, value: e.value ?? 0, arm: 0 });
  }
  return {
    list,
    events: [...names].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
  };
}

/** Conversões de uma meta do experimento, com o índice da variação. */
export function goalConversions(events: TrackingEvent[], goalId: string, variationIds: string[]) {
  const list: Conversion[] = [];
  for (const e of events) {
    if (e.type !== 'conversion' || e.qa || e.goalId !== goalId) continue;
    const arm = variationIds.indexOf(e.variationId);
    if (arm >= 0) list.push({ visitorId: e.visitorId, ts: e.ts, value: e.value ?? 0, arm });
  }
  return list;
}

/**
 * Páginas vistas dos visitantes que converteram, desde a janela antes do período. ponytail: até 400
 * visitantes filtra por id (D1 = lotes de 80, até 5 consultas); acima disso lê todas as páginas do intervalo
 * numa consulta só (mesmo resultado, mais CPU). Teto de eventos por consulta como no resto (D-041).
 */
export function loadTouches(
  repo: Repo,
  accountId: string,
  conversions: Conversion[],
  range: { from: Date; to: Date },
) {
  const ids = [...new Set(conversions.map((c) => c.visitorId))];
  if (!ids.length) return Promise.resolve(new Map<string, Touch[]>());
  return repo
    .listEvents(accountId, {
      types: ['pageview'],
      visitorIds: ids.length <= 400 ? ids : undefined,
      from: new Date(range.from.getTime() - WINDOW_MS),
      to: range.to,
    })
    .then(touchesByVisitor);
}
