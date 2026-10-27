import type { Props, Segment, SegmentRule, TrackingEvent } from '@abtest/shared';

/**
 * Resolução de identidade: cada `identify` com `userId` liga aquele visitante (cookie/dispositivo) ao usuário.
 * Perfil = usuário identificado (juntando todos os seus visitantes, em qualquer dispositivo) ou o visitante
 * anônimo. Um visitante identificado como dois usuários fica com o último.
 */
export function identityGraph(events: TrackingEvent[]): Map<string, string> {
  const user = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts))
    if (e.type === 'identify' && e.userId) user.set(e.visitorId, e.userId);
  return user;
}

export interface ProfileSummary {
  id: string;
  /** `user` = identificado; `anon` = só o cookie. */
  kind: 'user' | 'anon';
  userId?: string;
  visitors: string[];
  devices: string[];
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  pageviews: number;
  events: number;
  conversions: number;
  revenue: number;
  attributes: Props;
  /** experimentKey → variationKey (última exposição). */
  experiments: Record<string, string>;
  /** Contagem de eventos customizados por nome. */
  eventCounts: Record<string, number>;
}

/** Tipos de evento que montam um perfil (leia só estes antes de `buildProfiles`). */
export const PROFILE_EVENT_TYPES = ['pageview', 'event', 'identify', 'conversion', 'exposure'];

export function buildProfiles(events: TrackingEvent[]): Map<string, ProfileSummary> {
  const graph = identityGraph(events);
  const profiles = new Map<string, ProfileSummary & { _s: Set<string>; _d: Set<string>; _v: Set<string> }>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.qa) continue;
    const userId = graph.get(e.visitorId);
    const id = userId ? `u:${userId}` : `v:${e.visitorId}`;
    let p = profiles.get(id);
    if (!p)
      profiles.set(
        id,
        (p = {
          id,
          kind: userId ? 'user' : 'anon',
          ...(userId ? { userId } : {}),
          visitors: [],
          devices: [],
          firstSeen: e.ts,
          lastSeen: e.ts,
          sessions: 0,
          pageviews: 0,
          events: 0,
          conversions: 0,
          revenue: 0,
          attributes: {},
          experiments: {},
          eventCounts: {},
          _s: new Set(),
          _d: new Set(),
          _v: new Set(),
        }),
      );
    p.lastSeen = Math.max(p.lastSeen, e.ts);
    p.firstSeen = Math.min(p.firstSeen, e.ts);
    p._v.add(e.visitorId);
    if (e.sessionId) p._s.add(e.sessionId);
    if ('device' in e && e.device) p._d.add(e.device);
    if (e.type === 'pageview') p.pageviews++;
    else if (e.type === 'event') {
      p.events++;
      p.eventCounts[e.name] = (p.eventCounts[e.name] ?? 0) + 1;
      if (e.value) p.revenue += e.value;
    } else if (e.type === 'conversion') p.conversions++;
    else if (e.type === 'identify' && e.attrs) Object.assign(p.attributes, e.attrs);
    else if (e.type === 'exposure') p.experiments[e.experimentKey] = e.variationKey;
  }
  const out = new Map<string, ProfileSummary>();
  for (const [id, { _s, _d, _v, ...p }] of profiles)
    out.set(id, { ...p, visitors: [..._v], devices: [..._d], sessions: _s.size });
  return out;
}

/** Busca por usuário, visitante ou valor de atributo. */
export const profileMatches = (p: ProfileSummary, q: string) => {
  const s = q.toLowerCase();
  return (
    p.id.toLowerCase().includes(s) ||
    p.visitors.some((v) => v.toLowerCase().includes(s)) ||
    Object.values(p.attributes).some((v) => String(v).toLowerCase().includes(s))
  );
};

/** Cross-device: entre os usuários identificados, quantos usam mais de um dispositivo/navegador e quais combinações. */
export function crossDevice(profiles: Iterable<ProfileSummary>) {
  const combos = new Map<string, number>();
  let users = 0;
  let multi = 0;
  let multiBrowser = 0;
  for (const p of profiles) {
    if (p.kind !== 'user') continue;
    users++;
    if (p.devices.length > 1) multi++;
    if (p.visitors.length > 1) multiBrowser++;
    const k = [...p.devices].sort().join(' + ') || 'n/d';
    combos.set(k, (combos.get(k) ?? 0) + 1);
  }
  return {
    identified: users,
    multiDevice: multi,
    multiBrowser,
    combos: [...combos.entries()].sort((a, b) => b[1] - a[1]).map(([devices, count]) => ({ devices, count })),
  };
}

const DAY = 86_400_000;
const num = (op: 'gte' | 'lte' | 'eq', a: number, b: number) =>
  op === 'gte' ? a >= b : op === 'lte' ? a <= b : a === b;

/** Perfil atende à regra do segmento? `now` para "dias desde". */
export function matchSegmentRule(p: ProfileSummary, r: SegmentRule, now = Date.now()): boolean {
  switch (r.field) {
    case 'event':
      return num(r.op, p.eventCounts[r.name] ?? 0, r.value);
    case 'attribute': {
      const v = p.attributes[r.key];
      if (r.op === 'exists') return v !== undefined && v !== '';
      const s = v === undefined ? '' : String(v);
      return r.op === 'eq' ? s === r.value : r.op === 'neq' ? s !== r.value : s.includes(r.value);
    }
    case 'identified':
      return (p.kind === 'user') === r.value;
    case 'device':
      return p.devices.includes(r.value);
    case 'experiment':
      return r.key in p.experiments && (!r.variation || p.experiments[r.key] === r.variation);
    case 'devices':
      return num(r.op, p.devices.length, r.value);
    case 'lastSeenDays':
      return num(r.op, Math.floor((now - p.lastSeen) / DAY), r.value);
    case 'firstSeenDays':
      return num(r.op, Math.floor((now - p.firstSeen) / DAY), r.value);
    default:
      return num(r.op, p[r.field], r.value);
  }
}

export const matchSegment = (p: ProfileSummary, s: Segment, now = Date.now()) =>
  s.match === 'any'
    ? s.rules.some((r) => matchSegmentRule(p, r, now))
    : s.rules.every((r) => matchSegmentRule(p, r, now));
