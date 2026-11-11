import type { TrackingEvent } from '@abtest/shared';
import { expect, test } from 'vitest';
import { pagesReport } from './pages';

const ev = (url: string, type: 'pageview' | 'click', title?: string) =>
  ({ type, url, title, visitorId: 'v', ts: 1, accountId: 'a', sessionId: 's' }) as unknown as TrackingEvent;

test('mesma página em http/https, com barra, query ou index.html vira uma linha só', () => {
  const rows = pagesReport([
    ev('https://loja.com/loja/', 'pageview', 'Loja'),
    ev('http://loja.com/loja', 'click'),
    ev('https://loja.com/loja/index.html?utm_source=x', 'pageview'),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    page: 'https://loja.com/loja',
    title: 'Loja',
    pageviews: 2,
    clicks: 1,
  });
  expect(rows[0]!.href.startsWith('https:')).toBe(true);
});
