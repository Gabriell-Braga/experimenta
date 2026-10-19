// @vitest-environment jsdom
import { TrackingEventSchema, type PublishedConfig, type TrackingEvent } from '@abtest/shared';
import { beforeEach, expect, test } from 'vitest';
import { installData, loadProfile, PROFILE_KEY } from './data';
import { SID_KEY } from './env';
import { start } from './runtime';

const config: PublishedConfig = { accountId: 'acc', version: 1, publishedAt: '', experiments: [] };
let sent: TrackingEvent[];

beforeEach(() => {
  history.replaceState(null, '', '/home');
  document.cookie = `${SID_KEY}=; Max-Age=0; Path=/`;
  localStorage.clear();
  sent = [];
});

test('pageview ao carregar e a cada rota de SPA, com sessão e referrer da página anterior', () => {
  const rt = start(window, config)!;
  installData(window, rt, (e) => sent.push(e), localStorage);
  history.pushState(null, '', '/planos');
  const pvs = sent.filter((e) => e.type === 'pageview');
  expect(pvs).toHaveLength(2);
  expect(pvs[1]).toMatchObject({
    url: 'http://localhost:3000/planos',
    referrer: 'http://localhost:3000/home',
  });
  expect(pvs.every((e) => e.sessionId === rt.visitor.sessionId)).toBe(true);
  for (const e of sent) expect(TrackingEventSchema.safeParse(e).success).toBe(true);
  rt.stop();
});

test('eventos e identify atualizam o perfil local', () => {
  const rt = start(window, config)!;
  const data = installData(window, rt, (e) => sent.push(e), localStorage);
  data.track('add_to_cart', 99.9, { sku: 'TN-1' });
  data.track('add_to_cart');
  data.identify('user-42', { plano: 'pro' });
  expect(sent.find((e) => e.type === 'event')).toMatchObject({
    name: 'add_to_cart',
    value: 99.9,
    props: { sku: 'TN-1' },
  });
  expect(sent.find((e) => e.type === 'identify')).toMatchObject({
    userId: 'user-42',
    attrs: { plano: 'pro' },
  });
  const p = loadProfile(localStorage);
  expect(p).toMatchObject({ pv: 1, s: 1, ev: { add_to_cart: 2 }, u: 'user-42', a: { plano: 'pro' } });
  for (const e of sent) expect(TrackingEventSchema.safeParse(e).success).toBe(true);
  rt.stop();
});

test('perfil sobrevive entre páginas e conta sessões novas', () => {
  let rt = start(window, config)!;
  installData(window, rt, () => {}, localStorage);
  rt.stop();
  rt = start(window, config)!; // mesma sessão (cookie de sessão vivo)
  installData(window, rt, () => {}, localStorage);
  rt.stop();
  document.cookie = `${SID_KEY}=; Max-Age=0; Path=/`; // sessão expirou
  rt = start(window, config)!;
  installData(window, rt, () => {}, localStorage);
  rt.stop();
  expect(loadProfile(localStorage)).toMatchObject({ pv: 3, s: 2 });
  localStorage.setItem(PROFILE_KEY, '{quebrado');
  expect(loadProfile(localStorage).pv).toBe(0);
});
