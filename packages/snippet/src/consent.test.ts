// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { consentGate, CONSENT_KEY, forget, watchCmp, type App } from './consent';
import { readCookie, writeCookie } from './env';

type W = Window & Record<string, unknown>;
const w = window as unknown as W;

const fakeApp = () => {
  const app = { run: vi.fn(), stop: vi.fn() } satisfies App;
  const boot = vi.fn(() => app);
  return { app, boot };
};

beforeEach(() => {
  for (const c of document.cookie.split('; ')) writeCookie(document, c.split('=')[0]!, '', 0);
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  delete w.OptanonActiveGroups;
  delete w.Cookiebot;
  delete w.dataLayer;
});

test('sem exigência: liga direto e repassa os comandos', () => {
  const { app, boot } = fakeApp();
  const run = consentGate(window, undefined, boot);
  expect(boot).toHaveBeenCalledTimes(1);
  run(['track', 'x']);
  expect(app.run).toHaveBeenCalledWith(['track', 'x']);
});

test('esperar consentimento: nada roda nem é gravado até aceitar; comandos esperam e são repassados', () => {
  const { app, boot } = fakeApp();
  const run = consentGate(window, {}, boot);
  run(['track', 'antes']);
  expect(boot).not.toHaveBeenCalled();
  expect(document.cookie).toBe('');
  run(['consent', true]);
  expect(boot).toHaveBeenCalledTimes(1);
  expect(app.run).toHaveBeenCalledWith(['track', 'antes']);
  expect(readCookie(document, CONSENT_KEY)).toBe('1');
  // Próxima página: decisão lembrada, liga na hora.
  const next = fakeApp();
  consentGate(window, {}, next.boot);
  expect(next.boot).toHaveBeenCalledTimes(1);
});

test('recusa (opt-out): desliga, apaga cookies e storage do snippet e não liga nas próximas páginas', () => {
  const { app, boot } = fakeApp();
  const run = consentGate(window, undefined, boot);
  writeCookie(document, '_abt_vid', 'v1');
  writeCookie(document, 'do_site', 'fica');
  localStorage.setItem('_abt_p', '{}');
  localStorage.setItem('site', 'fica');
  sessionStorage.setItem('_abt_s', 'n');
  run(['consent', false]);
  expect(app.stop).toHaveBeenCalled();
  expect(readCookie(document, '_abt_vid')).toBeUndefined();
  expect(readCookie(document, 'do_site')).toBe('fica');
  expect(localStorage.getItem('_abt_p')).toBeNull();
  expect(localStorage.getItem('site')).toBe('fica');
  expect(sessionStorage.length).toBe(0);
  expect(readCookie(document, CONSENT_KEY)).toBe('0');
  run(['track', 'depois']);
  expect(app.run).not.toHaveBeenCalled();

  const next = fakeApp();
  consentGate(window, undefined, next.boot);
  expect(next.boot).not.toHaveBeenCalled();
});

test('link ?abt_optout=1 recusa', () => {
  history.replaceState(null, '', '/privacidade?abt_optout=1');
  const { boot } = fakeApp();
  consentGate(window, undefined, boot);
  expect(boot).not.toHaveBeenCalled();
  expect(readCookie(document, CONSENT_KEY)).toBe('0');
});

test('forget mantém a própria decisão', () => {
  writeCookie(document, CONSENT_KEY, '0');
  writeCookie(document, '_abt_sid', 's');
  forget(window);
  expect(document.cookie).toBe(`${CONSENT_KEY}=0`);
});

test('OneTrust: lê os grupos ativos e acompanha OneTrustGroupsUpdated', () => {
  const cb = vi.fn();
  watchCmp(window, { cmp: 'onetrust' }, cb);
  expect(cb).not.toHaveBeenCalled(); // banner ainda não carregou
  w.OptanonActiveGroups = ',C0001,';
  window.dispatchEvent(new Event('OneTrustGroupsUpdated'));
  w.OptanonActiveGroups = ',C0001,C0002,';
  window.dispatchEvent(new Event('OneTrustGroupsUpdated'));
  expect(cb.mock.calls).toEqual([[false], [true]]);

  const custom = vi.fn();
  watchCmp(window, { cmp: 'onetrust', category: 'C0004' }, custom);
  expect(custom).toHaveBeenCalledWith(false);
});

test('Cookiebot: só decide com resposta do visitante, na categoria configurada', () => {
  const cb = vi.fn();
  w.Cookiebot = { hasResponse: false, consent: { statistics: false } };
  watchCmp(window, { cmp: 'cookiebot' }, cb);
  expect(cb).not.toHaveBeenCalled();
  w.Cookiebot = { hasResponse: true, consent: { statistics: true, marketing: false } };
  window.dispatchEvent(new Event('CookiebotOnConsentReady'));
  expect(cb).toHaveBeenLastCalledWith(true);

  const mk = vi.fn();
  watchCmp(window, { cmp: 'cookiebot', category: 'marketing' }, mk);
  expect(mk).toHaveBeenCalledWith(false);
});

test('Google Consent Mode v2: "default" negado é ignorado; "update" decide; vale o que já estava no dataLayer', () => {
  function gtag(..._a: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  }
  w.dataLayer = [];
  gtag('consent', 'default', { analytics_storage: 'denied' });
  const cb = vi.fn();
  watchCmp(window, { cmp: 'gcm' }, cb);
  expect(cb).not.toHaveBeenCalled();
  gtag('consent', 'update', { ad_storage: 'granted' });
  expect(cb).not.toHaveBeenCalled(); // outra categoria
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('event', 'page_view');
  gtag('consent', 'update', { analytics_storage: 'denied' });
  expect(cb.mock.calls).toEqual([[true], [false]]);
  expect(w.dataLayer as unknown[]).toHaveLength(5);

  // Site fora da UE com "default" concedido: liga sem esperar update.
  delete w.dataLayer;
  const us = vi.fn();
  watchCmp(window, { cmp: 'gcm' }, us);
  gtag('consent', 'default', { analytics_storage: 'granted' });
  expect(us).toHaveBeenCalledWith(true);
});

test('CMP integrado ao portão: aceite pelo banner liga; recusa depois desliga', () => {
  const { app, boot } = fakeApp();
  consentGate(window, { cmp: 'cookiebot' }, boot);
  expect(boot).not.toHaveBeenCalled();
  w.Cookiebot = { hasResponse: true, consent: { statistics: true } };
  window.dispatchEvent(new Event('CookiebotOnConsentReady'));
  expect(boot).toHaveBeenCalledTimes(1);
  w.Cookiebot = { hasResponse: true, consent: { statistics: false } };
  window.dispatchEvent(new Event('CookiebotOnConsentReady'));
  expect(app.stop).toHaveBeenCalled();
  expect(readCookie(document, CONSENT_KEY)).toBe('0');
});
