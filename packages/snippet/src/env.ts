// Visitante, dispositivo e bots. Sem dependências: entra no bundle do site.
import type { Device } from '@abtest/shared';

export const VISITOR_KEY = '_abt_vid';
const SESSION_KEY = '_abt_s';
/** Sessão de analytics: cookie que expira após 30 min sem atividade (renovado a cada página). */
export const SID_KEY = '_abt_sid';
const ONE_YEAR = 60 * 60 * 24 * 365;
const SESSION_TTL = 30 * 60;

export interface Visitor {
  id: string;
  /** true durante toda a primeira sessão do visitante. */
  isNew: boolean;
  sessionId: string;
  /** Sessão começou neste carregamento de página. */
  newSession: boolean;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function readCookie(doc: Document, name: string): string | undefined {
  const m = doc.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function writeCookie(doc: Document, name: string, value: string, maxAge = ONE_YEAR): void {
  const secure = doc.location?.protocol === 'https:' ? '; Secure' : '';
  doc.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** Renova a sessão (30 min a partir de agora). */
export const touchSession = (doc: Document, sid: string) => writeCookie(doc, SID_KEY, sid, SESSION_TTL);

export function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/** ID do visitante em cookie first-party (fallback localStorage). Novo = criado nesta sessão. */
export function getVisitor(win: Window = window): Visitor {
  const doc = win.document;
  let id = readCookie(doc, VISITOR_KEY) ?? safe(() => win.localStorage.getItem(VISITOR_KEY)) ?? undefined;
  let session = safe(() => win.sessionStorage.getItem(SESSION_KEY));
  if (!id) {
    id = randomId();
    session = 'n';
  } else if (!session) session = 'r';
  writeCookie(doc, VISITOR_KEY, id);
  safe(() => win.localStorage.setItem(VISITOR_KEY, id!));
  safe(() => win.sessionStorage.setItem(SESSION_KEY, session!));
  const prev = readCookie(doc, SID_KEY);
  const sessionId = prev || randomId();
  touchSession(doc, sessionId);
  return { id, isNew: session === 'n', sessionId, newSession: !prev };
}

export function detectDevice(ua: string, width: number): Device {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';
  if (width > 0 && width < 768) return 'mobile';
  return 'desktop';
}

// ponytail: lista curta por UA; "HeadlessChrome" fica de fora de propósito (testes E2E rodam nele).
export const isBot = (ua: string): boolean =>
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|lighthouse|pingdom|google-inspectiontool/i.test(ua);
