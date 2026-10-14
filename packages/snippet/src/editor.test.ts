import type { PublishedConfig } from '@abtest/shared';
import { describe, expect, test, vi } from 'vitest';
import { bootEditor, editToken } from './editor';

const APP = 'https://app.abtest.dev';
const config: PublishedConfig = {
  accountId: 'acc',
  version: 1,
  publishedAt: '',
  apiUrl: 'https://api.abtest.dev',
  experiments: [],
};

/** Janela do site dentro de um iframe, com pai falso e fetch controlado. */
function fakeSite(opts: { session?: object | null; search?: string; topLevel?: boolean } = {}) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const appended: string[] = [];
  const store = new Map<string, string>();
  const parent = { postMessage: vi.fn() };
  const win = {
    location: { search: opts.search ?? '?abt_edit=tok', href: 'https://loja.com/' },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    fetch: vi.fn(async () =>
      opts.session === null
        ? { ok: false, json: async () => ({}) }
        : {
            ok: true,
            json: async () =>
              opts.session ?? { accountId: 'acc', appOrigin: APP, expiresAt: Date.now() + 60000 },
          },
    ),
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
    document: {
      head: { appendChild: (s: { src: string }) => appended.push(s.src) },
      createElement: () => ({ src: '' }),
    },
  } as unknown as Window & { __ABT_AGENT__?: unknown };
  (win as unknown as { parent: unknown }).parent = opts.topLevel ? win : parent;
  const send = (data: unknown, origin = APP, source: unknown = parent) =>
    listeners.forEach((fn) => fn({ data, origin, source } as MessageEvent));
  return { win, parent, appended, send, store };
}

const flush = () => new Promise((r) => setTimeout(r));

describe('editToken', () => {
  test('só dentro de iframe; guarda na sessão para navegação', () => {
    const { win, store } = fakeSite();
    expect(editToken(win)).toBe('tok');
    expect(store.get('_abt_edit')).toBe('tok');
    (win as unknown as { location: object }).location = { search: '' };
    expect(editToken(win)).toBe('tok');
    expect(editToken(fakeSite({ topLevel: true }).win)).toBeNull();
  });
});

describe('bootEditor', () => {
  test('caminho feliz: valida token, hello só para o origin do app, ack correto carrega o agent', async () => {
    const s = fakeSite();
    const p = bootEditor(s.win, config, 'tok', 'https://cdn/agent.js');
    await flush();
    expect(s.win.fetch).toHaveBeenCalledWith('https://api.abtest.dev/edit-sessions/tok');
    expect(s.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hello' }), APP);
    s.send({ abt: 1, kind: 'hello-ack', token: 'tok' });
    expect(await p).toEqual({ token: 'tok', appOrigin: APP, accountId: 'acc', apiUrl: config.apiUrl });
    expect(s.appended).toEqual(['https://cdn/agent.js']);
  });

  test('ack de origin errado, de outra janela ou com token errado é ignorado', async () => {
    vi.useFakeTimers();
    const s = fakeSite();
    const p = bootEditor(s.win, config, 'tok', 'https://cdn/agent.js');
    await vi.advanceTimersByTimeAsync(0);
    s.send({ abt: 1, kind: 'hello-ack', token: 'tok' }, 'https://evil.com');
    s.send({ abt: 1, kind: 'hello-ack', token: 'tok' }, APP, {});
    s.send({ abt: 1, kind: 'hello-ack', token: 'outro' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBeNull();
    expect(s.appended).toEqual([]);
    vi.useRealTimers();
  });

  test('token inválido, de outra conta ou expirado não inicia handshake', async () => {
    for (const session of [
      null,
      { accountId: 'outra', appOrigin: APP, expiresAt: Date.now() + 1000 },
      { accountId: 'acc', appOrigin: APP, expiresAt: 1 },
    ]) {
      const s = fakeSite({ session });
      expect(await bootEditor(s.win, config, 'tok', 'x')).toBeNull();
      expect(s.parent.postMessage).not.toHaveBeenCalled();
    }
    expect(await bootEditor(fakeSite().win, { ...config, apiUrl: undefined }, 'tok', 'x')).toBeNull();
  });
});
