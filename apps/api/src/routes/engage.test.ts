import { PublishedConfigSchema } from '@abtest/shared';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { createPublisher } from '../publish';
import { fsCdnStore } from '../cdn-fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const cdnDir = mkdtempSync(join(tmpdir(), 'abt-eng-'));
writeFileSync(join(cdnDir, 'abt.js'), '');

beforeAll(async () => {
  t = await setupApp({});
});

test('pop-ups em execução vão para a config publicada (pausados não); relatório por campanha', async () => {
  const mk = async (name: string, status: string) =>
    (
      (await (
        await t.req('/entities/popup', {
          as: 'editor',
          method: 'POST',
          body: JSON.stringify({ name, data: { status, title: name, trigger: { type: 'exit' } } }),
        })
      ).json()) as { id: string }
    ).id;
  const on = await mk('Cupom', 'running');
  await mk('Rascunho', 'draft');
  const publish = createPublisher({ repo: t.repo, cdn: fsCdnStore(cdnDir), publicUrl: 'https://x' });
  const owner = (await t.repo.getUser('demo', (await t.repo.findUserByEmail('demo@abtest.dev'))!.id))!;
  await publish('demo', owner);
  const cfg = PublishedConfigSchema.parse(JSON.parse(readFileSync(join(cdnDir, 'demo.json'), 'utf8')));
  expect(cfg.popups!.map((p) => [p.id, p.name, p.trigger.type])).toEqual([[on, 'Cupom', 'exit']]);

  const e = (visitorId: string, action: string) =>
    ev({ type: 'engage', visitorId, campaignId: on, kind: 'popup', action } as never);
  await t.collect([e('a', 'view'), e('a', 'click'), e('b', 'view'), e('b', 'close'), e('b', 'view')]);
  const [r] =
    await t.get<{ views: number; viewers: number; clicks: number; closes: number; ctr: number }[]>(
      '/analytics/engage',
    );
  expect(r).toMatchObject({ views: 3, viewers: 2, clicks: 1, closes: 1 });
  expect(r!.ctr).toBeCloseTo(1 / 3, 6);
});
