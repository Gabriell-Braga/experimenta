import type { PublishedConfig } from '@abtest/shared';

const EDIT_KEY = '_abt_edit';
export const HANDSHAKE_TIMEOUT_MS = 10000;

/** Dados que o agent recebe do snippet após o handshake (window.__ABT_AGENT__). */
export interface AgentBoot {
  token: string;
  appOrigin: string;
  accountId: string;
  apiUrl: string;
}

declare global {
  interface Window {
    __ABT_AGENT__?: AgentBoot;
  }
}

/**
 * Token de edição: `?abt_edit=<token>` (guardado na sessão para sobreviver à navegação dentro do iframe).
 * Só vale dentro de um iframe — aberto direto, o site roda normal.
 */
export function editToken(win: Window): string | null {
  if (win.parent === win) return null;
  let token = new URLSearchParams(win.location.search).get('abt_edit');
  try {
    if (token) win.sessionStorage.setItem(EDIT_KEY, token);
    else token = win.sessionStorage.getItem(EDIT_KEY);
  } catch {
    /* sem sessionStorage: só a página com o parâmetro */
  }
  return token;
}

/**
 * Modo edição exige as três coisas:
 * 1. parâmetro na URL (token); 2. token válido na API, emitido para ESTA conta, que informa o origin do app;
 * 3. handshake por postMessage em que a resposta vem da janela pai E do origin exato do app, ecoando o token.
 * Só então carrega o agent. Resolve com o boot do agent, ou null se qualquer passo falhar.
 */
export async function bootEditor(
  win: Window,
  config: PublishedConfig,
  token: string,
  agentUrl: string,
): Promise<AgentBoot | null> {
  if (!config.apiUrl) return null;
  let session: { accountId: string; appOrigin: string; expiresAt: number };
  try {
    const res = await win.fetch(`${config.apiUrl}/edit-sessions/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    session = await res.json();
  } catch {
    return null;
  }
  if (session.accountId !== config.accountId || session.expiresAt <= Date.now()) return null;
  const appOrigin = session.appOrigin;

  const acked = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => done(false), HANDSHAKE_TIMEOUT_MS);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { abt?: number; kind?: string; token?: string } | null;
      if (
        e.origin === appOrigin &&
        e.source === win.parent &&
        d?.abt === 1 &&
        d.kind === 'hello-ack' &&
        d.token === token
      )
        done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve(ok);
    };
    win.addEventListener('message', onMessage);
    // targetOrigin = origin do app: nenhuma outra página que emoldure o site recebe o hello.
    win.parent.postMessage({ abt: 1, kind: 'hello', url: win.location.href }, appOrigin);
  });
  if (!acked) return null;

  const boot: AgentBoot = { token, appOrigin, accountId: config.accountId, apiUrl: config.apiUrl };
  win.__ABT_AGENT__ = boot;
  const s = win.document.createElement('script');
  s.src = agentUrl;
  (win.document.head ?? win.document.documentElement).appendChild(s);
  return boot;
}
