// @vitest-environment jsdom
import { AudienceSchema, ExperimentSchema, type AudienceRule, type PublishedConfig } from '@abtest/shared';
import { beforeEach, expect, test } from 'vitest';
import { matchAudience, matchRule, type AudienceContext } from './audience';
import { loadProfile, notePage, PROFILE_KEY } from './data';
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
