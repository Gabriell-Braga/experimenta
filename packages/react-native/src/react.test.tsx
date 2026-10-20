// @vitest-environment jsdom
import { FlagSchema, ExperimentSchema, type SdkConfig } from '@abtest/shared';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { createMobileClient } from './client';
import { ExperimentaProvider, useFlag, useScreen, useTrack, useVariation } from './react';

const config: SdkConfig = {
  accountId: 'acc',
  version: 1,
  publishedAt: '',
  trackingUrl: 'https://api.test/collect',
  flags: [
    FlagSchema.parse({ key: 'pro', enabled: true, rules: [{ attribute: 'plano', op: 'eq', value: 'pro' }] }),
  ],
  experiments: [
    ExperimentSchema.parse({
      id: 'e1',
      key: 'checkout',
      name: 'Checkout',
      status: 'running',
      type: 'server',
      variations: [{ id: 'a', key: 'unica', name: 'Única', weight: 100, variables: { passos: 1 } }],
    }),
  ],
};

test('hooks: valores padrão até ficar pronto, re-render na config/identify, tela e track', async () => {
  const posts: { type: string }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('.sdk.json')) return new Response(JSON.stringify(config));
    posts.push(...JSON.parse(String(init!.body)).events);
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  const client = createMobileClient({
    accountId: 'acc',
    cdnUrl: 'https://cdn.test',
    fetch,
    flushMs: 3_600_000,
  });
  const wrapper = ({ children }: { children?: ReactNode }) => (
    <ExperimentaProvider client={client}>{children}</ExperimentaProvider>
  );
  const { result } = renderHook(
    () => {
      useScreen('Home');
      return {
        flag: useFlag('pro'),
        withAttr: useFlag('pro', { plano: 'pro' }),
        v: useVariation('checkout'),
        track: useTrack(),
      };
    },
    { wrapper },
  );
  expect(result.current.flag).toEqual({ enabled: false, variables: {}, ready: false });
  expect(result.current.v).toBeNull();
  await act(() => client.ready);
  expect(result.current.withAttr.enabled).toBe(true);
  expect(result.current.flag.enabled).toBe(false);
  expect(result.current.v).toEqual({ key: 'unica', variation: 'unica', variables: { passos: 1 } });
  act(() => client.identify('u1', { plano: 'pro' }));
  expect(result.current.flag).toEqual({ enabled: true, variables: {}, ready: true });
  result.current.track('compra', { value: 10 });
  await client.close();
  expect(posts.map((e) => e.type)).toEqual(['pageview', 'exposure', 'identify', 'event']);
});

test('hook fora do Provider explica o que fazer', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useFlag('x'))).toThrow(/ExperimentaProvider/);
});
