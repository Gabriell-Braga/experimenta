// Content script em todos os frames. Fora de iframe ou sem sessão ativa para esta aba/origin: não faz nada.
// Com sessão e SEM o snippet na página: injeta o script da conta, que faz o handshake normal e carrega o agent.

const SNIPPET_MARK = 'abtEditor';

async function main() {
  if (window.top === window) return;
  const params = new URLSearchParams(location.search);
  if (!params.has('abt_edit') && !sessionStorage.getItem('_abt_edit')) return;
  const session = (await chrome.runtime.sendMessage({ type: 'session' })) as {
    token: string;
    accountId: string;
    apiUrl: string;
  } | null;
  if (!session) return;
  // Dá tempo do snippet do site (se houver) se anunciar.
  const wait = () => new Promise((r) => setTimeout(r, 300));
  if (document.readyState === 'loading')
    await new Promise((r) => addEventListener('DOMContentLoaded', r, { once: true }));
  await wait();
  if (document.documentElement.dataset[SNIPPET_MARK]) return;
  const s = document.createElement('script');
  s.src = `${session.apiUrl}/cdn/${encodeURIComponent(session.accountId)}.js`;
  s.dataset.abtInjected = 'extension';
  document.documentElement.appendChild(s);
}

void main();
