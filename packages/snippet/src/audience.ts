// Avaliação de audiências salvas no navegador (sem ida ao servidor). Entra no bundle do site: manter enxuto.
import type { Audience, AudienceRule, Device } from '@abtest/shared';
import { readCookie } from './env';
import type { Profile } from './data';

export interface AudienceContext {
  win: Window;
  url: string;
  device: Device;
  isNew: boolean;
  profile: Profile;
  /** Score preditivo (0..1), quando houver modelo publicado. */
  score?: number;
}

type TextRule = { op: 'eq' | 'neq' | 'contains' | 'regex' | 'exists'; value: string };

function text(r: TextRule, v: string | undefined): boolean {
  if (r.op === 'exists') return !!v;
  const s = v ?? '';
  if (r.op === 'eq') return s === r.value;
  if (r.op === 'neq') return s !== r.value;
  if (r.op === 'contains') return s.includes(r.value);
  try {
    return new RegExp(r.value).test(s);
  } catch {
    return false;
  }
}

const num = (r: { op: 'gte' | 'lte' | 'eq'; value: number }, n: number) =>
  r.op === 'gte' ? n >= r.value : r.op === 'lte' ? n <= r.value : n === r.value;

/** Lê `a.b.0.c` a partir do window, sem lançar. */
function path(win: Window, p: string): string | undefined {
  let cur: unknown = win;
  for (const k of p.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur === undefined || cur === null ? undefined : String(cur);
}

/** iPad no iPadOS 13+ se apresenta como Mac: decide pelo toque. */
export const osOf = (ua: string) =>
  /iphone|ipad|ipod/i.test(ua)
    ? 'ios'
    : /android/i.test(ua)
      ? 'android'
      : /windows/i.test(ua)
        ? 'windows'
        : /mac/i.test(ua)
          ? 'mac'
          : /linux|cros/i.test(ua)
            ? 'linux'
            : '';

export function matchRule(r: AudienceRule, c: AudienceContext): boolean {
  const p = c.profile;
  switch (r.type) {
    case 'referrer':
      return text(r, c.win.document.referrer);
    case 'utm': {
      let cur: string | null = null;
      try {
        cur = new URL(c.url).searchParams.get(r.param);
      } catch {
        /* URL inválida */
      }
      return text(r, cur ?? p.t?.[r.param]);
    }
    case 'attribute': {
      const v = p.a[r.key];
      if (r.op === 'exists') return v !== undefined && v !== '';
      if (r.op === 'gte' || r.op === 'lte') return num({ op: r.op, value: Number(r.value) }, Number(v));
      return text({ op: r.op, value: r.value }, v === undefined ? undefined : String(v));
    }
    case 'pageviews':
      return num(r, p.pv);
    case 'sessions':
      return num(r, p.s);
    case 'event':
      return num(r, p.ev[r.name] ?? 0);
    case 'visited':
      return (p.p ?? []).some((x) => x.includes(r.value)) !== r.negate;
    case 'cookie':
      return text(r, readCookie(c.win.document, r.name));
    case 'js':
      return text(r, path(c.win, r.path));
    case 'language':
      return (c.win.navigator.language || '').toLowerCase().startsWith(r.value.toLowerCase());
    case 'time': {
      const d = new Date();
      const h = d.getHours();
      return h >= r.from && h < r.to && (!r.days.length || r.days.includes(d.getDay()));
    }
    case 'device':
      return c.device === r.value;
    case 'visitor':
      return (r.value === 'new') === c.isNew;
    case 'score':
      return c.score !== undefined && num(r, c.score);
    case 'os':
      return osOf(c.win.navigator.userAgent) == r.value;
    case 'source':
      return p.o == r.value;
    case 'landing':
      return text(r, p.lp);
    case 'query': {
      let v: string | null = null;
      try {
        v = new URL(c.url).searchParams.get(r.name);
      } catch {
        /* URL inválida */
      }
      return text(r, v ?? undefined);
    }
    case 'geo':
      return !!p.g && (p.g + '-').startsWith(r.country + '-' + (r.region ? r.region + '-' : ''));
    case 'clicked':
      return !!p.k?.includes(r.selector);
  }
}

export const matchAudience = (a: Audience, c: AudienceContext): boolean =>
  a.match === 'any' ? a.rules.some((r) => matchRule(r, c)) : a.rules.every((r) => matchRule(r, c));
