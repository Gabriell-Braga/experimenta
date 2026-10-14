import type { FrameLocator, Page } from '@playwright/test';

export const APP = 'http://localhost:5173';
export const SITE = 'http://localhost:5180';

interface HostWindow {
  __events: { event: string; payload: unknown }[];
  __call(method: string, params: object): Promise<unknown>;
  __reply?: (kind: string) => unknown;
}

/**
 * Página que imita o app do editor (sem UI): cria sessão, abre o site no iframe, faz o handshake,
 * registra os eventos do agent em window.__events e expõe window.__call(method, params).
 */
export async function openAgentHost(page: Page, path = '/') {
  const html = `<!doctype html><html><body style="margin:0;overflow:hidden"><iframe id="f" style="width:100vw;height:100vh;border:0;display:block"></iframe><script>
  window.__events = [];
  const pending = new Map();
  let seq = 0;
  const f = document.getElementById('f');
  window.__call = (method, params) => new Promise((resolve, reject) => {
    const id = 'h' + (++seq);
    pending.set(id, { resolve, reject });
    f.contentWindow.postMessage({ abt: 1, kind: 'req', id, method, params }, '${SITE}');
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== '${SITE}' || e.source !== f.contentWindow) return;
    const d = e.data || {};
    if (d.kind === 'hello') f.contentWindow.postMessage({ abt: 1, kind: 'hello-ack', token: window.__token }, '${SITE}');
    if (d.kind === 'evt') window.__events.push({ event: d.event, payload: d.payload });
    if (d.kind === 'res') { const p = pending.get(d.id); pending.delete(d.id); d.ok ? p.resolve(d.result) : p.reject(new Error(d.error)); }
    if (d.kind === 'req') {
      const result = window.__reply ? window.__reply(d.params.kind) : null;
      f.contentWindow.postMessage({ abt: 1, kind: 'res', id: d.id, ok: true, result }, '${SITE}');
    }
  });
  (async () => {
    const r = await fetch('http://localhost:4000/edit-sessions', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ accountId: 'demo' }) });
    window.__token = (await r.json()).token;
    f.src = '${SITE}${path}' + (${JSON.stringify(path)}.includes('?') ? '&' : '?') + 'abt_edit=' + encodeURIComponent(window.__token);
  })();
  </script></body></html>`;
  await page.route(`${APP}/host`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${APP}/host`);
  await waitEvent(page, 'ready');
  const frame: FrameLocator = page.frameLocator('#f');
  return {
    frame,
    call: <T = unknown>(method: string, params: object = {}) =>
      page.evaluate(
        ([m, p]) => (window as unknown as HostWindow).__call(m as string, p as object),
        [method, params],
      ) as Promise<T>,
    events: <T = unknown>(name: string) =>
      page.evaluate(
        (n) => (window as unknown as HostWindow).__events.filter((e) => e.event === n).map((e) => e.payload),
        name,
      ) as Promise<T[]>,
    /** Resposta do app ao `prompt` do agent (por tipo: 'html' | 'image'). */
    reply: (answers: Record<string, string | null>) =>
      page.evaluate((a) => {
        (window as unknown as HostWindow).__reply = (kind: string) => a[kind] ?? null;
      }, answers),
  };
}

export async function waitEvent(page: Page, name: string, count = 1) {
  await page.waitForFunction(
    ([n, c]) =>
      ((window as unknown as HostWindow).__events ?? []).filter((e) => e.event === n).length >= (c as number),
    [name, count],
  );
}
