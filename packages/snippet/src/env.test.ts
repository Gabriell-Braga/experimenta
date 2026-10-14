// @vitest-environment jsdom
import { SegmentationSchema } from '@abtest/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { readConfig } from './config';
import { detectDevice, getVisitor, isBot, readCookie, VISITOR_KEY } from './env';
import { matchSegmentation, matchUrl } from './segment';

describe('visitante', () => {
  beforeEach(() => {
    document.cookie = `${VISITOR_KEY}=; Max-Age=0; Path=/`;
    localStorage.clear();
    sessionStorage.clear();
  });

  test('cria id em cookie first-party e localStorage; novo na primeira sessão', () => {
    const v = getVisitor();
    expect(v.isNew).toBe(true);
    expect(readCookie(document, VISITOR_KEY)).toBe(v.id);
    expect(localStorage.getItem(VISITOR_KEY)).toBe(v.id);
    expect(getVisitor()).toEqual(v); // mesma sessão continua "novo"
  });

  test('recorrente em nova sessão', () => {
    const v = getVisitor();
    sessionStorage.clear();
    expect(getVisitor()).toEqual({ id: v.id, isNew: false });
  });

  test('fallback em localStorage quando o cookie some', () => {
    const v = getVisitor();
    document.cookie = `${VISITOR_KEY}=; Max-Age=0; Path=/`;
    expect(getVisitor().id).toBe(v.id);
    expect(readCookie(document, VISITOR_KEY)).toBe(v.id); // cookie restaurado
  });
});

test('detecção de dispositivo e bots', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
  const ipad = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)';
  const androidTab = 'Mozilla/5.0 (Linux; Android 13; SM-X700)';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
  expect(detectDevice(iphone, 390)).toBe('mobile');
  expect(detectDevice(ipad, 1024)).toBe('tablet');
  expect(detectDevice(androidTab, 1200)).toBe('tablet');
  expect(detectDevice(chrome, 1440)).toBe('desktop');
  expect(detectDevice(chrome, 500)).toBe('mobile');
  expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
  expect(isBot('Mozilla/5.0 AhrefsBot/7.0')).toBe(true);
  expect(isBot(chrome)).toBe(false);
  expect(isBot('Mozilla/5.0 HeadlessChrome/130.0')).toBe(false);
});

describe('segmentação', () => {
  const ctx = {
    url: 'https://loja.com/produto/123?utm_source=google&x=1',
    device: 'desktop' as const,
    isNew: true,
  };
  const seg = (s: object) => SegmentationSchema.parse(s);

  test('matchUrl: exata, contém, regex', () => {
    expect(matchUrl({ match: 'exact', value: 'https://loja.com/', exclude: false }, 'https://loja.com')).toBe(
      true,
    );
    expect(
      matchUrl({ match: 'exact', value: 'https://loja.com/a', exclude: false }, 'https://loja.com/a#x'),
    ).toBe(true);
    expect(
      matchUrl({ match: 'exact', value: 'https://loja.com/a', exclude: false }, 'https://loja.com/ab'),
    ).toBe(false);
    expect(matchUrl({ match: 'contains', value: '/produto/', exclude: false }, ctx.url)).toBe(true);
    expect(matchUrl({ match: 'regex', value: '/produto/\\d+', exclude: false }, ctx.url)).toBe(true);
    expect(matchUrl({ match: 'regex', value: '([', exclude: false }, ctx.url)).toBe(false);
  });

  test('vazia = todos', () => expect(matchSegmentation(seg({}), ctx)).toBe(true));

  test('URLs: inclusões em OU, exclusão vence', () => {
    const urls = [
      { match: 'contains', value: '/carrinho' },
      { match: 'contains', value: '/produto' },
    ];
    expect(matchSegmentation(seg({ urls }), ctx)).toBe(true);
    expect(
      matchSegmentation(seg({ urls: [...urls, { match: 'contains', value: '123', exclude: true }] }), ctx),
    ).toBe(false);
    expect(matchSegmentation(seg({ urls: [{ match: 'contains', value: '/blog' }] }), ctx)).toBe(false);
  });

  test('dispositivo, query e visitante', () => {
    expect(matchSegmentation(seg({ devices: ['mobile'] }), ctx)).toBe(false);
    expect(matchSegmentation(seg({ devices: ['mobile', 'desktop'] }), ctx)).toBe(true);
    expect(matchSegmentation(seg({ query: [{ key: 'utm_source', value: 'google' }] }), ctx)).toBe(true);
    expect(matchSegmentation(seg({ query: [{ key: 'utm_source', value: 'bing' }] }), ctx)).toBe(false);
    expect(matchSegmentation(seg({ query: [{ key: 'x' }] }), ctx)).toBe(true);
    expect(matchSegmentation(seg({ query: [{ key: 'y' }] }), ctx)).toBe(false);
    expect(matchSegmentation(seg({ visitor: 'returning' }), ctx)).toBe(false);
    expect(matchSegmentation(seg({ visitor: 'new' }), ctx)).toBe(true);
  });
});

test('readConfig lê window.__ABT_CONFIG__', () => {
  expect(readConfig()).toBeNull();
  window.__ABT_CONFIG__ = { accountId: 'a', version: 1, publishedAt: '', experiments: [] };
  expect(readConfig()?.accountId).toBe('a');
  delete window.__ABT_CONFIG__;
});
