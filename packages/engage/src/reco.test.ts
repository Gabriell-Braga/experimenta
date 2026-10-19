// @vitest-environment jsdom
import { RecoWidgetSchema, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import type { RecoModel } from '@abtest/shared/reco';
import type { EngageBoot } from '@abtest/snippet/engage';
import { expect, test, vi } from 'vitest';
import { startRecos } from './reco';

const model: RecoModel = {
  builtAt: '',
  catalog: {
    '1': { name: 'Runner', price: 599.9, category: 'corrida', url: '/p/1' },
    '2': { name: 'Trail', price: 689.9, category: 'corrida', url: 'javascript:alert(1)' },
    '3': { name: 'Meia', price: 89.9, category: 'acessorios' },
  },
  coview: { '1': ['2', '3'] },
  copurchase: {},
  trending: ['3', '1'],
  bestsellers: [],
  byCategory: {},
};

test('vitrine entra depois do elemento, com produtos do último visto, e registra exibição e clique', async () => {
  document.body.innerHTML = '<main><div id="grade"></div></main>';
  const sent: TrackingEvent[] = [];
  const config: PublishedConfig = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    experiments: [],
    recos: [
      {
        id: 'r1',
        name: 'Vitrine',
        ...RecoWidgetSchema.parse({ status: 'running', selector: '#grade', strategy: 'coview', limit: 2 }),
      },
    ],
  };
  const boot: EngageBoot = {
    config,
    cdnBase: '',
    send: (e) => sent.push(e),
    flush: () => {},
    base: () => ({ eventId: 'e', ts: 1, accountId: 'acc', visitorId: 'v', url: location.href }),
    ctx: () => ({
      win: window,
      url: location.href,
      device: 'desktop',
      isNew: false,
      profile: { pv: 1, s: 1, ev: {}, f: 0, l: 0, a: {}, r: ['3', '1'] },
    }),
    onNavigate: [],
  };
  startRecos(window, boot, async () => model);
  await vi.waitFor(() => expect(document.querySelector('#grade + abt-reco')).not.toBeNull());
  const root = document.querySelector('abt-reco')!.shadowRoot!;
  const cards = [...root.querySelectorAll('a')];
  expect(cards.map((a) => a.dataset.product)).toEqual(['2', '3']); // vistos junto com "1" (último visto)
  expect(cards[0]!.getAttribute('href')).toBeNull(); // javascript: bloqueado
  expect(root.querySelector('.p')!.textContent).toContain('689,90');
  cards[1]!.click();
  expect(sent.map((e) => e.type === 'engage' && `${e.kind}:${e.action}`)).toEqual([
    'reco:view',
    'reco:click',
  ]);
});
