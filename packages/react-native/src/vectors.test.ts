// O SDK React Native decide com o mesmo núcleo do SDK TS (packages/sdk + snippet/bucket), então tem de bater
// com sdks/test-vectors.json: um cliente por usuário (visitorId = id do vetor), sem histórico de atribuição.
import type { SdkConfig } from '@abtest/shared';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createMobileClient } from './client';

const vectors = JSON.parse(
  readFileSync(new URL('../../../sdks/test-vectors.json', import.meta.url), 'utf8'),
) as {
  config: SdkConfig;
  users: string[];
  experiments: { key: string; variations: (string | null)[] }[];
  flags: { key: string; attributes: Record<string, string | number | boolean>; enabled: boolean[] }[];
};

test('decisões de campanhas e flags iguais aos vetores de compatibilidade', async () => {
  let checks = 0;
  for (const [i, user] of vectors.users.entries()) {
    const c = createMobileClient({
      accountId: vectors.config.accountId,
      cdnUrl: '',
      config: vectors.config,
      visitorId: user,
      fetch: (async () => new Response(null, { status: 204 })) as never,
      flushMs: 3_600_000,
    });
    await c.ready;
    for (const e of vectors.experiments) {
      expect(c.getVariation(e.key)?.key ?? null, `${e.key} / ${JSON.stringify(user)}`).toBe(e.variations[i]);
      checks++;
    }
    for (const f of vectors.flags) {
      expect(c.isEnabled(f.key, f.attributes), `${f.key} / ${JSON.stringify(user)}`).toBe(f.enabled[i]);
      checks++;
    }
    await c.close();
  }
  expect(checks).toBeGreaterThan(3000);
});
