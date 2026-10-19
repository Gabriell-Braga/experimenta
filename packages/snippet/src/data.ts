// Coleta de dados do visitante: páginas vistas, eventos customizados, identificação e perfil local.
// Entra no bundle do site: manter enxuto.
import type { Props, TrackingEvent } from '@abtest/shared';
import { detectDevice, touchSession } from './env';
import type { Runtime } from './runtime';

export const PROFILE_KEY = '_abt_p';

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

export interface DataApi {
  profile: Profile;
  track(name: string, value?: number, props?: Props): void;
  identify(userId: string | null | undefined, attrs?: Props): void;
}

export function installData(
  win: Window,
  rt: Runtime,
  send: (e: TrackingEvent) => void,
  storage?: Storage,
): DataApi {
  const doc = win.document;
  const profile = loadProfile(storage);
  const save = () => {
    profile.l = Date.now();
    try {
      storage?.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* storage cheio ou bloqueado */
    }
  };
  if (rt.visitor.newSession) profile.s++;

  let referrer = doc.referrer;
  const pageview = () => {
    touchSession(doc, rt.visitor.sessionId);
    profile.pv++;
    save();
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
    track(name, value, props) {
      profile.ev[name] = (profile.ev[name] ?? 0) + 1;
      save();
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
      save();
      send({
        ...rt.base(),
        type: 'identify',
        ...(userId ? { userId: String(userId) } : {}),
        ...(attrs ? { attrs } : {}),
      });
    },
  };
}
