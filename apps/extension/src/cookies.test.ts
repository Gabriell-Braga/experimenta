import { describe, expect, test } from 'vitest';
import { canBeSecure, cookieMatchesOrigin, relaxCookies, restoreCookies, type CookiesApi } from './cookies';
import { createSessions, type EditSession } from './session';

const cookie = (o: Partial<chrome.cookies.Cookie>): chrome.cookies.Cookie => ({
  name: 'sessao',
  value: 'ok',
  domain: 'loja.com',
  hostOnly: true,
  path: '/',
  secure: false,
  httpOnly: true,
  sameSite: 'lax',
  session: true,
  storeId: '0',
  ...o,
});

/** Pote de cookies falso indexado por nome+domínio+caminho. */
function jar(initial: chrome.cookies.Cookie[]) {
  const all = new Map(initial.map((c) => [`${c.name}|${c.domain}|${c.path}`, c]));
  const api: CookiesApi = {
    getAll: async () => [...all.values()],
    get: async ({ name }) => [...all.values()].find((c) => c.name === name) ?? null,
    set: async (d) => {
      const c = cookie({
        name: d.name!,
        value: d.value!,
        domain: d.domain ?? new URL(d.url).hostname,
        hostOnly: !d.domain,
        path: d.path!,
        secure: !!d.secure,
        httpOnly: !!d.httpOnly,
        sameSite: d.sameSite!,
      });
      all.set(`${c.name}|${c.domain}|${c.path}`, c);
      return c;
    },
  };
  return { api, all: () => [...all.values()] };
}

test('regras de domínio e de Secure', () => {
  expect(cookieMatchesOrigin({ domain: '.loja.com' }, 'https://www.loja.com')).toBe(true);
  expect(cookieMatchesOrigin({ domain: 'loja.com' }, 'https://loja.com')).toBe(true);
  expect(cookieMatchesOrigin({ domain: 'outraloja.com' }, 'https://loja.com')).toBe(false);
  expect(canBeSecure('https://loja.com')).toBe(true);
  expect(canBeSecure('http://127.0.0.1:5180')).toBe(true);
  expect(canBeSecure('http://loja.com')).toBe(false);
});

describe('afrouxar e restaurar', () => {
  test('Lax/Strict viram None+Secure; None fica; fim da sessão restaura o original mantendo o valor atual', async () => {
    const j = jar([
      cookie({ name: 'a', sameSite: 'lax' }),
      cookie({ name: 'b', sameSite: 'strict', domain: '.loja.com', hostOnly: false }),
      cookie({ name: 'c', sameSite: 'no_restriction', secure: true }),
    ]);
    const saved = await relaxCookies(j.api, 'https://loja.com');
    expect(saved.map((s) => [s.name, s.sameSite])).toEqual([
      ['a', 'lax'],
      ['b', 'strict'],
    ]);
    expect(j.all().every((c) => c.sameSite === 'no_restriction' && c.secure)).toBe(true);
    // O site renova o valor durante a sessão.
    await j.api.set({
      url: 'https://loja.com/',
      name: 'a',
      value: 'novo',
      path: '/',
      sameSite: 'no_restriction',
      secure: true,
    });
    await restoreCookies(j.api, saved);
    const byName = Object.fromEntries(j.all().map((c) => [c.name, c]));
    expect(byName.a).toMatchObject({ value: 'novo', sameSite: 'lax', secure: false });
    expect(byName.b).toMatchObject({ sameSite: 'strict', domain: '.loja.com' });
    expect(byName.c!.sameSite).toBe('no_restriction');
  });

  test('site http (não localhost) não é tocado: Secure seria rejeitado', async () => {
    const j = jar([cookie({})]);
    expect(await relaxCookies(j.api, 'http://loja.com')).toEqual([]);
    expect(j.all()[0]!.sameSite).toBe('lax');
  });
});

test('sessões: afrouxa ao abrir, cookie novo durante a sessão, restaura ao fechar', async () => {
  const j = jar([cookie({ name: 'antes' })]);
  let saved: EditSession[] = [];
  const s = createSessions(
    { get: async () => saved, set: async (l) => void (saved = l) },
    { updateSessionRules: async () => {} },
    undefined,
    j.api,
  );
  await s.start(1, { siteOrigin: 'https://loja.com', token: 't', accountId: 'a', apiUrl: 'https://api' });
  const novo = await j.api.set({
    url: 'https://loja.com/',
    name: 'login',
    value: 'x',
    path: '/',
    sameSite: 'lax',
  });
  await s.onCookie(novo!);
  await s.onCookie(cookie({ name: 'de-outro', domain: 'outro.com' })); // outro site: ignora
  expect(
    j
      .all()
      .filter((c) => c.domain === 'loja.com')
      .every((c) => c.sameSite === 'no_restriction'),
  ).toBe(true);
  await s.end(1);
  expect(
    j
      .all()
      .filter((c) => c.domain === 'loja.com')
      .map((c) => c.sameSite),
  ).toEqual(['lax', 'lax']);
});
