// Content script em todos os frames. Fora de iframe ou sem sessão ativa para esta aba/origin: não faz nada.
// Com sessão e SEM o snippet na página: faz o handshake com o app e pede ao service worker para injetar o agent
// empacotado na extensão (chrome.scripting no mundo MAIN não passa pelo CSP do site, ex.: Instagram).

const SNIPPET_MARK = 'abtEditor';
const HANDSHAKE_TIMEOUT_MS = 10000;

async function main() {
  if (window.top === window) return;
  const params = new URLSearchParams(location.search);
  if (!params.has('abt_edit') && !sessionStorage.getItem('_abt_edit')) return;
  // SPAs (ex.: Instagram) reescrevem a URL antes do snippet rodar: guarda o token já (o snippet lê daqui).
  if (params.has('abt_edit')) sessionStorage.setItem('_abt_edit', params.get('abt_edit')!);
  const session = (await chrome.runtime.sendMessage({ type: 'session' })) as {
    token: string;
    appOrigin: string;
  } | null;
  if (!session) return;
  // Dá tempo do snippet do site (se houver) se anunciar.
  const wait = () => new Promise((r) => setTimeout(r, 300));
  if (document.readyState === 'loading')
    await new Promise((r) => addEventListener('DOMContentLoaded', r, { once: true }));
  await wait();
  if (document.documentElement.dataset[SNIPPET_MARK]) return;
  document.documentElement.dataset[SNIPPET_MARK] = 'extension';

  // Mesmo handshake do snippet (packages/snippet/src/editor.ts): ack só da janela pai, no origin do app, com o token.
  const acked = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => done(false), HANDSHAKE_TIMEOUT_MS);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { abt?: number; kind?: string; token?: string } | null;
      if (
        e.origin === session.appOrigin &&
        e.source === window.parent &&
        d?.abt === 1 &&
        d.kind === 'hello-ack' &&
        d.token === session.token
      )
        done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(ok);
    };
    addEventListener('message', onMessage);
    window.parent.postMessage({ abt: 1, kind: 'hello', url: location.href }, session.appOrigin);
  });
  if (acked) await chrome.runtime.sendMessage({ type: 'inject' });
}

void main();
