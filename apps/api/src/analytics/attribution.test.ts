import { expect, test } from 'vitest';
import { ev } from '../test-app';
import { attribute, classify, touchesByVisitor } from './attribution';

const S = 'https://loja.com/';
const ch = (url: string, ref?: string) => classify(url, ref)?.channel ?? null;

test('classifica canais por UTM, id de clique e referrer', () => {
  expect(ch(`${S}?utm_source=google&utm_medium=cpc&utm_campaign=x`)).toBe('paid');
  expect(ch(`${S}?gclid=abc`)).toBe('paid');
  expect(classify(`${S}?gclid=abc`)?.source).toBe('google');
  expect(ch(`${S}?utm_source=newsletter&utm_medium=email`)).toBe('email');
  expect(ch(`${S}?utm_source=instagram`)).toBe('social');
  expect(ch(`${S}?utm_source=parceiro&utm_medium=afiliado`)).toBe('campaign');
  expect(ch(S, 'https://www.google.com.br/search?q=x')).toBe('organic');
  expect(ch(S, 'https://mail.google.com/')).toBe('email');
  expect(ch(S, 'https://l.instagram.com/')).toBe('social');
  expect(ch(S, 'https://t.co/abc')).toBe('social');
  expect(ch(S, 'https://blog.exemplo.com/post')).toBe('referral');
  expect(classify(S, 'https://blog.exemplo.com/post')).toMatchObject({
    source: 'blog.exemplo.com',
    campaign: '(sem campanha)',
  });
  expect(ch(S)).toBe('direct');
  expect(ch(S, 'https://www.loja.com/carrinho')).toBeNull(); // navegação interna
});

test('toques: 1ª página de cada visita e UTM no meio da visita; referrer externo no meio não conta', () => {
  const pv = (sessionId: string, ts: number, url: string, referrer?: string) =>
    ev({ type: 'pageview', visitorId: 'v', sessionId, ts, url, referrer } as never);
  const t = touchesByVisitor([
    pv('s1', 1, `${S}?utm_source=google&utm_medium=cpc`, 'https://www.google.com/'),
    pv('s1', 2, `${S}p`, S),
    pv('s1', 3, `${S}obrigado`, 'https://pagseguro.uol.com.br/'),
    pv('s1', 4, `${S}?utm_source=news&utm_medium=email`, S),
    pv('s2', 5, S),
  ]).get('v')!;
  expect(t.map((x) => x.channel)).toEqual(['paid', 'email', 'direct']);
});

test('primeiro toque e último toque não direto, com janela de 30 dias', () => {
  const DAY = 86_400_000;
  const T = 100 * DAY;
  const touches = new Map([
    [
      'v',
      [
        { ts: T - 40 * DAY, channel: 'social' as const, source: 'instagram', campaign: '(sem campanha)' },
        { ts: T - 10 * DAY, channel: 'organic' as const, source: 'google.com', campaign: '(sem campanha)' },
        { ts: T - 5 * DAY, channel: 'email' as const, source: 'news', campaign: 'outubro' },
        { ts: T - DAY, channel: 'direct' as const, source: '(direto)', campaign: '(sem campanha)' },
        { ts: T + DAY, channel: 'paid' as const, source: 'google', campaign: 'depois' },
      ],
    ],
    ['d', [{ ts: T - DAY, channel: 'direct' as const, source: '(direto)', campaign: '(sem campanha)' }]],
  ]);
  const r = attribute(
    [
      { visitorId: 'v', ts: T, value: 100, arm: 1 },
      { visitorId: 'd', ts: T, value: 20, arm: 0 },
      { visitorId: 'sem-visita', ts: T, value: 5, arm: 0 },
    ],
    touches,
    2,
  );
  expect(r).toMatchObject({ conversions: 3, revenue: 125, windowDays: 30 });
  // Instagram ficou fora da janela; o direto da véspera não tira o crédito do e-mail.
  expect(r.first.channel.map((x) => [x.key, x.conversions, x.revenue])).toEqual([
    ['organic', [0, 1], [0, 100]],
    ['direct', [2, 0], [25, 0]],
  ]);
  expect(r.last.channel[0]).toMatchObject({ key: 'email', revenue: [0, 100] });
  expect(r.last.campaign[0]).toMatchObject({ key: 'outubro', channel: 'email' });
  expect(r.last.source.find((x) => x.key === '(direto)')?.conversions).toEqual([2, 0]);
});
