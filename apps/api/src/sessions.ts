import { randomBytes } from 'node:crypto';

export interface EditSession {
  token: string;
  accountId: string;
  /** Origin exato do app do editor que abriu a sessão (o snippet só conversa com ele). */
  appOrigin: string;
  expiresAt: number;
}

export const EDIT_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * Tokens de edição de curta duração.
 * ponytail: em memória (perdem-se ao reiniciar a API e não escalam para várias instâncias); mover para o banco/Redis
 * quando houver mais de uma instância.
 */
export function createSessionStore(now = () => Date.now()) {
  const sessions = new Map<string, EditSession>();
  return {
    create(accountId: string, appOrigin: string): EditSession {
      const s = {
        token: randomBytes(24).toString('base64url'),
        accountId,
        appOrigin,
        expiresAt: now() + EDIT_SESSION_TTL_MS,
      };
      sessions.set(s.token, s);
      return s;
    },
    get(token: string): EditSession | undefined {
      const s = sessions.get(token);
      if (s && s.expiresAt <= now()) sessions.delete(token);
      return s && s.expiresAt > now() ? s : undefined;
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
