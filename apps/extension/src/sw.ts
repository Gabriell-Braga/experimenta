// Service worker da extensão. Só age em sessões de edição iniciadas pelo app do editor (via bridge).
import { createSessions, parseStart, type EditSession } from './session';

const KEY = 'sessions';
const sessions = createSessions(
  {
    get: async () => ((await chrome.storage.session.get(KEY))[KEY] as EditSession[] | undefined) ?? [],
    set: (list) => chrome.storage.session.set({ [KEY]: list }),
  },
  chrome.declarativeNetRequest,
  undefined,
  chrome.cookies,
);

chrome.runtime.onMessage.addListener((msg: { type?: string; payload?: unknown }, sender, reply) => {
  const tabId = sender.tab?.id;
  (async () => {
    switch (msg?.type) {
      // Do bridge (frame principal da aba do app): abre/encerra a sessão DESTA aba.
      case 'start': {
        if (tabId === undefined || sender.frameId !== 0) return { ok: false, error: 'origem inválida' };
        const req = parseStart(msg.payload);
        if (!req) return { ok: false, error: 'pedido inválido' };
        const s = await sessions.start(tabId, { ...req, appOrigin: sender.origin });
        return { ok: true, expiresAt: s.expiresAt };
      }
      case 'end':
        if (tabId !== undefined && sender.frameId === 0) await sessions.end(tabId);
        return { ok: true };
      // Do content script do site (iframe): só recebe a sessão se estiver na aba e no origin certos.
      case 'session': {
        if (!sender.frameId) return null; // frame principal nunca é o site emoldurado
        const s = await sessions.forFrame(tabId, sender.origin);
        return s?.appOrigin ? { token: s.token, appOrigin: s.appOrigin } : null;
      }
      // Do content script do site, após o handshake: agent empacotado no mundo MAIN (ignora o CSP da página).
      case 'inject': {
        const s = sender.frameId ? await sessions.forFrame(tabId, sender.origin) : null;
        if (!s?.appOrigin) return null;
        const target = { tabId: tabId!, frameIds: [sender.frameId!] };
        const boot = { token: s.token, appOrigin: s.appOrigin, accountId: s.accountId, apiUrl: s.apiUrl };
        await chrome.scripting.executeScript({
          target,
          world: 'MAIN',
          func: (b: typeof boot) => void ((window as Window & { __ABT_AGENT__?: unknown }).__ABT_AGENT__ = b),
          args: [boot],
        });
        await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['agent.js'] });
        return { ok: true };
      }
    }
    return null;
  })().then(reply, () => reply(null));
  return true; // resposta assíncrona
});

chrome.tabs.onRemoved.addListener((tabId) => void sessions.end(tabId));
chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
  if (!removed) void sessions.onCookie(cookie);
});
