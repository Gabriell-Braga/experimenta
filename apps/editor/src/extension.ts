/**
 * Conversa com a extensão (apps/extension) pela ponte injetada nesta página: window.postMessage com `abtExt`.
 * Resolve null se a extensão não estiver instalada (timeout).
 */
let seq = 0;

export function extCall<T = unknown>(
  type: 'ping' | 'start' | 'end',
  payload?: unknown,
  timeoutMs = 800,
): Promise<T | null> {
  const id = `x${++seq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), timeoutMs);
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { abtExt?: string; id?: string; result?: T } | null;
      if (e.source === window && d?.abtExt === 'reply' && d.id === id) done(d.result ?? null);
    };
    const done = (v: T | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMsg);
      resolve(v);
    };
    addEventListener('message', onMsg);
    postMessage({ abtExt: type, id, payload }, location.origin);
  });
}

export interface ExtSession {
  siteOrigin: string;
  token: string;
  accountId: string;
  apiUrl: string;
}

export const startExtensionSession = (s: ExtSession) =>
  extCall<{ ok: boolean; error?: string }>('start', s, 3000);
export const endExtensionSession = () => extCall('end');
