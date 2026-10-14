import { randomToken } from './crypto';

export interface EditSession {
  token: string;
  accountId: string;
  /** Origin exato do app do editor que abriu a sessão (o snippet só conversa com ele). */
  appOrigin: string;
  expiresAt: number;
}

export const EDIT_SESSION_TTL_MS = 15 * 60 * 1000;

export interface SessionStore {
  create(accountId: string, appOrigin: string): Promise<EditSession>;
  get(token: string): Promise<EditSession | undefined>;
}

export const newSession = (accountId: string, appOrigin: string, now: number): EditSession => ({
  token: randomToken(),
  accountId,
  appOrigin,
  expiresAt: now + EDIT_SESSION_TTL_MS,
});

/**
 * Tokens de edição em memória (servidor Node de uma instância só). No Worker, as sessões ficam no D1
 * (`createD1SessionStore`), porque isolates não compartilham memória.
 */
export function createSessionStore(now = () => Date.now()): SessionStore {
  const sessions = new Map<string, EditSession>();
  return {
    async create(accountId, appOrigin) {
      const s = newSession(accountId, appOrigin, now());
      sessions.set(s.token, s);
      return s;
    },
    async get(token) {
      const s = sessions.get(token);
      if (s && s.expiresAt <= now()) sessions.delete(token);
      return s && s.expiresAt > now() ? s : undefined;
    },
  };
}
