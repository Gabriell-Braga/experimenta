// @vitest-environment jsdom
import { AudienceSchema, ExperimentSchema, type AudienceRule, type PublishedConfig } from '@abtest/shared';
import { beforeEach, expect, test } from 'vitest';
import { matchAudience, matchRule, osOf, type AudienceContext } from './audience';
import { loadProfile, notePage, PROFILE_KEY, trafficSource } from './data';
import { SID_KEY } from './env';
import { start } from './runtime';

const ctx = (o: Partial<AudienceContext> = {}): AudienceContext => ({
  win: window,
  url: 'https://loja.com/produto?utm_source=google',
  device: 'desktop',
  isNew: false,
  profile: {
    pv: 4,
    s: 2,
    ev: { compra: 1 },
    f: 0,
    l: 0,
    a: { plano: 'pro', idade: 34 },
    p: ['/', '/checkout'],
    t: { utm_campaign: 'black' },
  },
  ...o,
});
const rule = (r: object) => r as AudienceRule;

beforeEach(() => {
  localStorage.clear();
  document.cookie = `${SID_KEY}=; Max-Age=0; Path=/`;
  document.cookie = 'tier=gold; Path=/';
  history.replaceState(null, '', '/home');
});

test('regras de comportamento, origem, atributos, cookie, variável JS, idioma e horário', () => {
  const c = ctx();
  expect(matchRule(rule({ type: 'pageviews', op: 'gte', value: 3 }), c)).toBe(true);
  expect(matchRule(rule({ type: 'sessions', op: 'gte', value: 3 }), c)).toBe(false);
  expect(matchRule(rule({ type: 'event', name: 'compra', op: 'gte', value: 1 }), c)).toBe(true);
  expect(matchRule(rule({ type: 'visited', value: '/checkout', negate: false }), c)).toBe(true);
  expect(matchRule(rule({ type: 'visited', value: '/obrigado', negate: true }), c)).toBe(true);
  expect(matchRule(rule({ type: 'utm', param: 'utm_source', op: 'eq', value: 'google' }), c)).toBe(true); // URL atual
  expect(matchRule(rule({ type: 'utm', param: 'utm_campaign', op: 'eq', value: 'black' }), c)).toBe(true); // 1ª visita
  expect(matchRule(rule({ type: 'attribute', key: 'plano', op: 'eq', value: 'pro' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'attribute', key: 'idade', op: 'gte', value: '30' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'attribute', key: 'nada', op: 'exists', value: '' }), c)).toBe(false);
  expect(matchRule(rule({ type: 'cookie', name: 'tier', op: 'eq', value: 'gold' }), c)).toBe(true);
  (window as unknown as { app: unknown }).app = { user: { tipo: 'b2b' } };
  expect(matchRule(rule({ type: 'js', path: 'app.user.tipo', op: 'eq', value: 'b2b' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'js', path: 'app.nao.existe', op: 'exists', value: '' }), c)).toBe(false);
  expect(matchRule(rule({ type: 'language', value: navigator.language.slice(0, 2) }), c)).toBe(true);
  expect(matchRule(rule({ type: 'time', from: 0, to: 24, days: [] }), c)).toBe(true);
  expect(matchRule(rule({ type: 'referrer', op: 'contains', value: 'google' }), c)).toBe(false); // jsdom sem referrer
  expect(matchRule(rule({ type: 'visitor', value: 'returning' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'score', op: 'gte', value: 0.5 }), ctx({ score: 0.7 }))).toBe(true);
  expect(matchRule(rule({ type: 'score', op: 'gte', value: 0.5 }), c)).toBe(false);
});

test('todas (all) ou qualquer (any)', () => {
  const a = AudienceSchema.parse({
    match: 'all',
    rules: [
      { type: 'pageviews', op: 'gte', value: 3 },
      { type: 'device', value: 'mobile' },
    ],
  });
  expect(matchAudience(a, ctx())).toBe(false);
  expect(matchAudience({ ...a, match: 'any' }, ctx())).toBe(true);
});

test('perfil: página vista atualiza contagens, caminhos (sem repetir) e a origem da 1ª visita', () => {
  const p = loadProfile(localStorage);
  notePage(p, 'https://loja.com/?utm_source=insta&utm_campaign=x', 'https://www.instagram.com/p/1', true);
  notePage(p, 'https://loja.com/produto?utm_source=google');
  notePage(p, 'https://loja.com/');
  expect(p).toMatchObject({
    pv: 3,
    s: 1,
    p: ['/produto', '/'],
    t: { utm_source: 'insta', utm_campaign: 'x', ref: 'www.instagram.com' },
  });
});

test('experimento com audiência só ativa quem bate; audiência ausente na config = ninguém', () => {
  const exp = (id: string, audiences: string[]) =>
    ExperimentSchema.parse({
      id,
      key: id,
      name: id,
      status: 'running',
      audiences,
      variations: [{ id: `${id}_v`, key: 'v', name: 'V', weight: 1 }],
    });
  const config: PublishedConfig = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    experiments: [exp('fieis', ['aud_fieis']), exp('sem', ['aud_apagada']), exp('livre', [])],
    audiences: [{ id: 'aud_fieis', match: 'all', rules: [{ type: 'pageviews', op: 'gte', value: 3 }] }],
  };
  let rt = start(window, config)!; // 1ª página vista
  expect([...rt.active.keys()]).toEqual(['livre']);
  rt.stop();
  rt = start(window, config)!;
  rt.stop();
  rt = start(window, config)!; // 3ª página vista: entra na audiência
  expect([...rt.active.keys()].sort()).toEqual(['fieis', 'livre']);
  rt.stop();
  expect(JSON.parse(localStorage.getItem(PROFILE_KEY)!).pv).toBe(3);
});

test('fase 21.6: sistema operacional, origem do tráfego, landing page, parâmetro de URL, geo e clicou em', () => {
  expect(osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
  expect(osOf('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  expect(osOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
  expect(osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('mac');

  const src = (url: string, ref = '') => trafficSource(new URL(url), ref);
  expect(src('https://loja.com/')).toBe('direct');
  expect(src('https://loja.com/', 'https://loja.com/a')).toBe('direct');
  expect(src('https://loja.com/', 'https://www.google.com/')).toBe('search');
  expect(src('https://loja.com/', 'https://l.instagram.com/')).toBe('social');
  expect(src('https://loja.com/', 'https://blog.parceiro.com/')).toBe('referral');
  expect(src('https://loja.com/?utm_medium=email&utm_source=rd')).toBe('crm');
  expect(src('https://loja.com/?utm_medium=cpc&utm_source=google')).toBe('paid');

  // Origem e landing são da sessão: gravadas só na 1ª página dela.
  const p = loadProfile(undefined);
  notePage(p, 'https://loja.com/promo?utm_medium=newsletter', '', true);
  notePage(p, 'https://loja.com/produto?plano=pro', 'https://loja.com/promo');
  p.g = 'BR-SP';
  p.k = ['#comprar'];
  const c = ctx({ profile: p, url: 'https://loja.com/produto?plano=pro' });
  expect(matchRule(rule({ type: 'source', value: 'crm' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'landing', op: 'contains', value: '/promo' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'query', name: 'plano', op: 'eq', value: 'pro' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'query', name: 'x', op: 'exists', value: '' }), c)).toBe(false);
  expect(matchRule(rule({ type: 'geo', country: 'BR', region: '' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'geo', country: 'BR', region: 'SP' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'geo', country: 'BR', region: 'RJ' }), c)).toBe(false);
  expect(matchRule(rule({ type: 'geo', country: 'B', region: '' }), c)).toBe(false);
  expect(matchRule(rule({ type: 'clicked', selector: '#comprar' }), c)).toBe(true);
  expect(matchRule(rule({ type: 'geo', country: 'BR', region: '' }), ctx())).toBe(false); // geo ainda não chegou
});

test('runtime: clicar no elemento da regra "clicou em" coloca o visitante na audiência; geo vem da API', async () => {
  document.body.innerHTML = '<button id="comprar"><span>Comprar</span></button>';
  const fetchMock = async () => Response.json({ country: 'BR', region: 'SP' });
  const orig = window.fetch;
  window.fetch = fetchMock as typeof window.fetch;
  const exp = ExperimentSchema.parse({
    id: 'e1',
    key: 'e1',
    name: 'E1',
    status: 'running',
    audiences: ['a1', 'a2'],
    variations: [{ id: 'v1', key: 'v1', name: 'V1', weight: 1 }],
  });
  const config = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    apiUrl: 'http://api.test',
    experiments: [exp],
    audiences: [
      { id: 'a1', ...AudienceSchema.parse({ rules: [{ type: 'clicked', selector: '#comprar' }] }) },
      { id: 'a2', ...AudienceSchema.parse({ rules: [{ type: 'geo', country: 'BR', region: 'SP' }] }) },
    ],
  } as PublishedConfig;
  const rt = start(window, config)!;
  expect(rt.active.size).toBe(0);
  document.querySelector('span')!.click();
  expect(rt.profile.k).toEqual(['#comprar']);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(rt.profile.g).toBe('BR-SP');
  expect(rt.active.has('e1')).toBe(true);
  rt.stop();
  window.fetch = orig;
});
