/** Sessão de edição aberta pelo app numa aba específica. */
export interface EditSession {
  /** Aba do app do editor que pediu a sessão (as regras só valem nela). */
  tabId: number;
  /** Origin exato do site emoldurado no iframe. */
  siteOrigin: string;
  token: string;
  accountId: string;
  apiUrl: string;
  /** ID da regra declarativeNetRequest desta sessão. */
  ruleId: number;
  expiresAt: number;
}

export const SESSION_TTL_MS = 15 * 60 * 1000;

/** Regex para casar URLs do origin exato (esquema + host + porta), sem casar host parecido. */
export function originRegex(origin: string): string {
  return `^${origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(/|$|\\?|#)`;
}

/**
 * Regra de sessão do declarativeNetRequest: SÓ na aba do editor, SÓ em sub_frame, SÓ no origin do site.
 * Remove X-Frame-Options e o CSP (DNR não edita diretivas: remove o header inteiro, como fazem Adobe/Builder.io).
 */
export function buildRule(
  s: Pick<EditSession, 'tabId' | 'siteOrigin' | 'ruleId'>,
): chrome.declarativeNetRequest.Rule {
  return {
    id: s.ruleId,
    priority: 1,
    condition: {
      tabIds: [s.tabId],
      resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType],
      regexFilter: originRegex(s.siteOrigin),
    },
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: [
        'x-frame-options',
        'content-security-policy',
        'content-security-policy-report-only',
      ].map((header) => ({ header, operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation })),
    },
  };
}

export type StartRequest = { siteOrigin: string; token: string; accountId: string; apiUrl: string };

/** Valida o pedido vindo do app (via bridge). Só http(s) e origin "puro". */
export function parseStart(msg: unknown): StartRequest | null {
  const m = msg as Partial<StartRequest> | null;
  if (!m || typeof m.token !== 'string' || typeof m.accountId !== 'string' || typeof m.apiUrl !== 'string')
    return null;
  try {
    const u = new URL(m.siteOrigin ?? '');
    if (!/^https?:$/.test(u.protocol) || u.origin !== m.siteOrigin) return null;
    new URL(m.apiUrl);
  } catch {
    return null;
  }
  return { siteOrigin: m.siteOrigin!, token: m.token, accountId: m.accountId, apiUrl: m.apiUrl };
}

/** Estado das sessões (persistido em chrome.storage.session: o service worker pode ser encerrado a qualquer momento). */
export interface Store {
  get(): Promise<EditSession[]>;
  set(list: EditSession[]): Promise<void>;
}

export interface Dnr {
  updateSessionRules(o: {
    addRules?: chrome.declarativeNetRequest.Rule[];
    removeRuleIds?: number[];
  }): Promise<void>;
}

export function createSessions(store: Store, dnr: Dnr, now = () => Date.now()) {
  const alive = (list: EditSession[]) => list.filter((s) => s.expiresAt > now());

  async function prune(): Promise<EditSession[]> {
    const list = await store.get();
    const keep = alive(list);
    const dead = list.filter((s) => !keep.includes(s));
    if (dead.length) {
      await dnr.updateSessionRules({ removeRuleIds: dead.map((s) => s.ruleId) });
      await store.set(keep);
    }
    return keep;
  }

  return {
    /** Abre (ou renova) a sessão da aba do editor. Uma sessão por aba. */
    async start(tabId: number, req: StartRequest): Promise<EditSession> {
      const list = await prune();
      const prev = list.find((s) => s.tabId === tabId);
      const ruleId = prev?.ruleId ?? Math.max(0, ...list.map((s) => s.ruleId)) + 1;
      const session: EditSession = { ...req, tabId, ruleId, expiresAt: now() + SESSION_TTL_MS };
      await dnr.updateSessionRules({ removeRuleIds: [ruleId], addRules: [buildRule(session)] });
      await store.set([...list.filter((s) => s.tabId !== tabId), session]);
      return session;
    },

    async end(tabId: number): Promise<void> {
      const list = await store.get();
      const s = list.find((x) => x.tabId === tabId);
      if (!s) return;
      await dnr.updateSessionRules({ removeRuleIds: [s.ruleId] });
      await store.set(list.filter((x) => x !== s));
    },

    /** Sessão visível para um frame: precisa estar na aba do editor e no origin do site da sessão. */
    async forFrame(tabId: number | undefined, frameOrigin: string | undefined): Promise<EditSession | null> {
      if (tabId === undefined || !frameOrigin) return null;
      return (await prune()).find((s) => s.tabId === tabId && s.siteOrigin === frameOrigin) ?? null;
    },
  };
}
