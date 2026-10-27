// Coleta de dados do visitante: páginas vistas, eventos customizados, identificação e perfil local.
// Entra no bundle do site: manter enxuto.
import type { Props, TrackingEvent } from '@abtest/shared';
import { detectDevice, touchSession } from './env';
import type { Runtime } from './runtime';

export const PROFILE_KEY = '_abt_p';
const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/** Perfil local (localStorage): base da segmentação comportamental. Chaves curtas = menos bytes. */
export interface Profile {
  /** Páginas vistas e sessões. */
  pv: number;
  s: number;
  /** Contagem de eventos customizados por nome. */
  ev: Record<string, number>;
  /** Primeira e última atividade (ms). */
  f: number;
  l: number;
  /** Usuário identificado e atributos. */
  u?: string;
  a: Props;
  /** Caminhos visitados (últimos 30, sem repetir). */
  p?: string[];
  /** Origem da 1ª visita (first-touch): UTMs e `ref` (host de referência). */
  t?: Record<string, string>;
  /** Produtos vistos (últimos 20 ids, o mais recente no fim) — recomendações. */
  r?: string[];
  /** Sessão atual: origem do tráfego e página de entrada. */
  o?: string;
  lp?: string;
  /** País-estado do IP (`BR-SP`), buscado uma vez por sessão quando alguma audiência usa localização. */
  g?: string;
  /** Seletores das regras "clicou em" que o visitante já clicou. */
  k?: string[];
}

export function loadProfile(storage: Storage | undefined): Profile {
  try {
    const p = JSON.parse(storage?.getItem(PROFILE_KEY) ?? '') as Profile;
    if (p && typeof p.pv === 'number') return p;
  } catch {
    /* perfil ausente ou corrompido: recomeça */
  }
  const now = Date.now();
  return { pv: 0, s: 0, ev: {}, f: now, l: now, a: {} };
}

export function saveProfile(storage: Storage | undefined, p: Profile): void {
  p.l = Date.now();
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage cheio ou bloqueado */
  }
}

/** Página vista: atualiza contagens, caminhos e a origem da 1ª visita (antes de avaliar as audiências). */
export function notePage(p: Profile, url: string, referrer = '', newSession = false): void {
  p.pv++;
  try {
    const u = new URL(url);
    if (newSession) {
      p.s++;
      p.o = trafficSource(u, referrer);
      p.lp = url.slice(0, 500);
    }
    p.p = [...(p.p ?? []).filter((x) => x !== u.pathname), u.pathname].slice(-30);
    if (!p.t) {
      const t: Record<string, string> = {};
      for (const k of UTMS) {
        const v = u.searchParams.get(k);
        if (v) t[k] = v.slice(0, 100);
      }
      if (referrer) t.ref = new URL(referrer).host;
      p.t = t;
    }
  } catch {
    /* URL inválida: só as contagens */
  }
}

/** Origem do tráfego (regra de audiência `source`): UTMs primeiro, depois o referrer. */
export function trafficSource(u: URL, referrer: string): string {
  const m = (u.searchParams.get('utm_medium') || '') + ' ' + (u.searchParams.get('utm_source') || '');
  let host = '';
  try {
    host = new URL(referrer).host;
  } catch {
    /* sem referrer */
  }
  const social = /facebook|instagram|twitter|t\.co|x\.com|linkedin|tiktok|youtube|pinterest|whatsapp|social/;
  return /mail|crm|newsletter/.test(m)
    ? 'crm'
    : /cpc|ppc|paid|ads/.test(m)
      ? 'paid'
      : social.test(m + host)
        ? 'social'
        : /google|bing|yahoo|duckduckgo|yandex|baidu|ecosia/.test(host)
          ? 'search'
          : host && host != u.host
            ? 'referral'
            : m.trim()
              ? 'referral'
              : 'direct';
}

export interface DataApi {
  profile: Profile;
  viewed(productId: string): void;
  track(name: string, value?: number, props?: Props): void;
  identify(userId: string | null | undefined, attrs?: Props): void;
}

/** Envia pageviews (carga e rotas de SPA), eventos e identify. O perfil é atualizado pelo runtime. */
export function installData(
  win: Window,
  rt: Runtime,
  send: (e: TrackingEvent) => void,
  storage?: Storage,
): DataApi {
  const doc = win.document;
  const profile = rt.profile;
  let referrer = doc.referrer;
  const pageview = () => {
    touchSession(doc, rt.visitor.sessionId);
    send({
      ...rt.base(),
      type: 'pageview',
      device: detectDevice(win.navigator.userAgent, win.innerWidth),
      title: doc.title.slice(0, 300) || undefined,
      referrer: referrer.slice(0, 1000) || undefined,
      vw: win.innerWidth,
    });
    referrer = win.location.href; // na SPA, a página anterior é o referrer da próxima
  };
  pageview();
  rt.onNavigate.push(pageview);

  return {
    profile,
    viewed(id) {
      profile.r = [...(profile.r ?? []).filter((x) => x !== id), id].slice(-20);
      saveProfile(storage, profile);
    },
    track(name, value, props) {
      profile.ev[name] = (profile.ev[name] ?? 0) + 1;
      saveProfile(storage, profile);
      send({
        ...rt.base(),
        type: 'event',
        name: String(name).slice(0, 100),
        ...(typeof value === 'number' ? { value } : {}),
        ...(props ? { props } : {}),
      });
    },
    identify(userId, attrs) {
      if (userId) profile.u = String(userId);
      if (attrs) Object.assign(profile.a, attrs);
      saveProfile(storage, profile);
      send({
        ...rt.base(),
        type: 'identify',
        ...(userId ? { userId: String(userId) } : {}),
        ...(attrs ? { attrs } : {}),
      });
      // Atributos novos podem colocar o visitante numa audiência.
      rt.evaluate();
    },
  };
}
