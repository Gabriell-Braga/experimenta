// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { startRecorder } from './recorder';

const boot = {
  apiUrl: 'https://api.test',
  accountId: 'acc',
  visitorId: 'v1',
  sessionId: 's1',
  device: 'desktop' as const,
  record: true,
  forms: false,
  send: () => {},
  base: () => ({ eventId: 'e', ts: 0, accountId: 'acc', visitorId: 'v1', url: '' }),
  variations: () => ({}),
  onNavigate: [],
};

function setup(maxBytes = 1000) {
  const calls: { url: string; body: { events: unknown[]; sessionId: string }; keepalive: boolean }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), keepalive: !!init.keepalive });
    return new Response(null, { status: 204 });
  });
  let emit!: (e: { timestamp: number; type: number; data?: unknown }) => void;
  const r = startRecorder(window, boot, {
    flushMs: 1000,
    maxBytes,
    fetch: fetch as unknown as typeof globalThis.fetch,
    record: (o) => {
      emit = o.emit;
      return () => {};
    },
  });
  return { calls, emit: (e: { timestamp: number; type: number; data?: unknown }) => emit(e), r };
}

test('envia em blocos pelo intervalo, com sessão e visitante', () => {
  vi.useFakeTimers();
  const { calls, emit, r } = setup();
  emit({ timestamp: 1, type: 3, data: { x: 1 } });
  emit({ timestamp: 2, type: 3, data: { x: 2 } });
  expect(calls).toHaveLength(0);
  vi.advanceTimersByTime(1000);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ url: 'https://api.test/rec', body: { sessionId: 's1', visitorId: 'v1' } });
  expect(calls[0]!.body.events).toHaveLength(2);
  vi.advanceTimersByTime(1000); // nada novo: não envia
  expect(calls).toHaveLength(1);
  r.stop();
  vi.useRealTimers();
});

test('snapshot completo sai na hora; ao sair da página usa keepalive', () => {
  const { calls, emit, r } = setup();
  emit({ timestamp: 1, type: 4, data: { href: 'x' } });
  emit({ timestamp: 2, type: 2, data: { node: {} } });
  expect(calls).toHaveLength(1);
  emit({ timestamp: 3, type: 3, data: {} });
  window.dispatchEvent(new Event('pagehide'));
  expect(calls).toHaveLength(2);
  expect(calls[1]!.keepalive).toBe(true);
  r.stop();
});

test('bloco grande demais é dividido', () => {
  const { calls, emit, r } = setup(10_000_000);
  const big = 'x'.repeat(300_000);
  for (let i = 0; i < 4; i++) emit({ timestamp: i, type: 3, data: { big } });
  r.flush();
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls.reduce((n, c) => n + c.body.events.length, 0)).toBe(4);
  r.stop();
});
