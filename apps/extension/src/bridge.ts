// Content script no app do editor: ponte window.postMessage ↔ service worker.
// O app não precisa saber o ID da extensão; só páginas dos origins do editor (manifest) recebem esta ponte.

const VERSION = chrome.runtime.getManifest().version;

window.addEventListener('message', async (e: MessageEvent) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data as { abtExt?: string; id?: string; payload?: unknown } | null;
  if (!d?.abtExt || d.abtExt === 'reply') return;
  let result: unknown = null;
  if (d.abtExt === 'ping') result = { version: VERSION };
  else if (d.abtExt === 'start' || d.abtExt === 'end')
    result = await chrome.runtime.sendMessage({ type: d.abtExt, payload: d.payload });
  window.postMessage({ abtExt: 'reply', id: d.id, result }, location.origin);
});

// Anuncia presença (o app pode ter carregado antes).
window.postMessage({ abtExt: 'reply', id: 'announce', result: { version: VERSION } }, location.origin);
