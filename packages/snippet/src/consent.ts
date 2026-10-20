// Consentimento LGPD/GDPR. A decisão do visitante fica no cookie `_abt_c` (1 aceitou, 0 recusou): é o único que
// o snippet grava sem consentimento, porque guardar a recusa é necessário para respeitá-la nas próximas páginas.
import type { PublishedConfig } from '@abtest/shared';
import { readCookie, writeCookie } from './env';

export const CONSENT_KEY = '_abt_c';
type Consent = NonNullable<PublishedConfig['consent']>;
type W = Window & {
  OptanonActiveGroups?: string;
  Cookiebot?: { hasResponse?: boolean; consent?: Record<string, boolean> };
  dataLayer?: unknown[];
};

/** Snippet ligado (testes, cookies e coleta): executa comandos da fila e desliga tudo na recusa. */
export interface App {
  run(c: unknown[]): void;
  stop(): void;
}

/** Apaga cookies e storage do snippet, menos a própria decisão. */
export function forget(win: Window): void {
  const doc = win.document;
  for (const c of doc.cookie.split('; ')) {
    const name = c.split('=')[0]!;
    if (name.startsWith('_abt') && name !== CONSENT_KEY) writeCookie(doc, name, '', 0);
  }
  for (const k of ['localStorage', 'sessionStorage'] as const)
    try {
      const s = win[k];
      for (let i = s.length; i--;) {
        const key = s.key(i)!;
        if (key.startsWith('_abt')) s.removeItem(key);
      }
    } catch {
      /* storage bloqueado: nada gravado */
    }
}

/**
 * Lê o banner de consentimento (CMP) configurado e chama `cb` com a decisão, agora e a cada mudança.
 * Sem resposta do visitante ainda, não chama nada (o snippet continua esperando).
 */
export function watchCmp(win: Window, c: Consent, cb: (ok: boolean) => void): void {
  const w = win as W;
  const cat = c.category;
  if (c.cmp === 'onetrust') {
    // Grupos ativos: ",C0001,C0002,". O evento sai ao carregar e a cada mudança.
    const check = () =>
      w.OptanonActiveGroups && cb(w.OptanonActiveGroups.split(',').includes(cat || 'C0002'));
    check();
    win.addEventListener('OneTrustGroupsUpdated', check);
  } else if (c.cmp === 'cookiebot') {
    // Sem `?.`: o alvo es2019 transpila cada um em bytes a mais no snippet.
    const check = () => {
      const b = w.Cookiebot;
      if (b && b.hasResponse) cb(!!(b.consent || {})[cat || 'statistics']);
    };
    check();
    // Sai ao carregar uma decisão salva e a cada aceite/recusa.
    win.addEventListener('CookiebotOnConsentReady', check);
  } else if (c.cmp === 'gcm') {
    // Google Consent Mode v2: gtag('consent', 'default' | 'update', { analytics_storage: 'granted' }) vai
    // para o dataLayer. "default" negado é só o estado inicial (o CMP manda "update" com a escolha): ignorado,
    // para quem já aceitou não ser desligado e religado a cada página.
    const dl = (w.dataLayer = w.dataLayer || []);
    const check = (a: unknown) => {
      const [cmd, kind, s] = a as [string, string, Record<string, string> | undefined];
      const v = s && s[cat || 'analytics_storage'];
      if (cmd === 'consent' && v && (kind === 'update' || v === 'granted')) cb(v === 'granted');
    };
    dl.forEach(check);
    const push = dl.push;
    dl.push = (...a) => {
      a.forEach(check);
      return push.apply(dl, a);
    };
  }
}

/**
 * Liga o snippet conforme o consentimento e devolve o executor da fila `abq`. Sem exigência na conta, liga
 * direto (a menos que o visitante tenha recusado). `['consent', true|false]` aceita ou recusa a qualquer momento;
 * recusar desliga o que estiver rodando e apaga cookies e storage. Comandos chegados antes do aceite esperam.
 */
export function consentGate(win: Window, c: Consent | undefined, boot: () => App | undefined) {
  const doc = win.document;
  const held: unknown[][] = [];
  let app: App | undefined;
  const set = (ok: boolean) => {
    if (ok) app = app || boot();
    else {
      if (app) app.stop();
      app = undefined;
      held.length = 0;
      forget(win);
    }
    writeCookie(doc, CONSENT_KEY, ok ? '1' : '0');
    if (app) for (const cmd of held.splice(0)) app.run(cmd);
  };
  const run = (cmd: unknown[]) => {
    if (cmd[0] === 'consent') set(!!cmd[1]);
    else if (app) app.run(cmd);
    else if (held.length < 100) held.push(cmd);
  };
  const saved = readCookie(doc, CONSENT_KEY);
  // Link de saída para a política de privacidade: `?abt_optout=1`.
  if (/[?&]abt_optout=1/.test(win.location.search)) set(false);
  else if (saved === '1' || (!saved && !c)) app = boot();
  if (c) watchCmp(win, c, set);
  return run;
}
