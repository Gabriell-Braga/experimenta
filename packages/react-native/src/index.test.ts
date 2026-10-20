// react-native aqui é o stub de test/react-native-stub.ts (alias no vitest.config.ts).
import { AppState } from 'react-native';
import { expect, test, vi } from 'vitest';
import { createClient, readDevice } from './index';

test('createClient liga o AppState e os dados do aparelho', async () => {
  expect(readDevice()).toEqual({ platform: 'ios', osVersion: '17.4', type: 'mobile', width: 390 });
  const posts: { type: string; attrs?: unknown }[] = [];
  const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
    posts.push(...JSON.parse(String(init!.body)).events);
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const c = createClient({
    accountId: 'acc',
    cdnUrl: '',
    config: {
      accountId: 'acc',
      version: 1,
      publishedAt: '',
      trackingUrl: 'https://t/c',
      flags: [],
      experiments: [],
    },
    fetch,
    appVersion: '1.0.0',
    flushMs: 3_600_000,
  });
  await c.ready;
  (AppState as unknown as { emit(s: string): void }).emit('background');
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    type: 'identify',
    attrs: { platform: 'ios', osVersion: '17.4', deviceType: 'mobile', appVersion: '1.0.0' },
  });
  await c.close();
});
