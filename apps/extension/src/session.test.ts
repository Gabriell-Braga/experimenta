import { describe, expect, test } from 'vitest';
import {
  buildRule,
  createSessions,
  originRegex,
  parseStart,
  SESSION_TTL_MS,
  type EditSession,
} from './session';

function fakeChrome() {
  let saved: EditSession[] = [];
  const rules = new Map<number, chrome.declarativeNetRequest.Rule>();
  return {
    rules,
    store: { get: async () => saved, set: async (l: EditSession[]) => void (saved = l) },
    dnr: {
      updateSessionRules: async (o: {
        addRules?: chrome.declarativeNetRequest.Rule[];
        removeRuleIds?: number[];
      }) => {
        o.removeRuleIds?.forEach((id) => rules.delete(id));
        o.addRules?.forEach((r) => rules.set(r.id, r));
      },
    },
  };
}

const req = {
  siteOrigin: 'https://loja.com',
  token: 't',
  accountId: 'demo',
  apiUrl: 'https://api.abtest.dev',
};

describe('regra declarativeNetRequest', () => {
  test('só na aba do editor, só sub_frame, só no origin do site; remove XFO e CSP', () => {
    const r = buildRule({ tabId: 7, siteOrigin: 'https://loja.com', ruleId: 3 });
    expect(r.condition).toEqual({
      tabIds: [7],
      resourceTypes: ['sub_frame'],
      regexFilter: originRegex('https://loja.com'),
    });
    expect(r.action.responseHeaders!.map((h) => [h.header, h.operation])).toEqual([
      ['x-frame-options', 'remove'],
      ['content-security-policy', 'remove'],
      ['content-security-policy-report-only', 'remove'],
    ]);
  });

  test('regex do origin não casa hosts parecidos nem outra porta', () => {
    const re = new RegExp(originRegex('http://localhost:5181'));
    expect(re.test('http://localhost:5181/')).toBe(true);
    expect(re.test('http://localhost:5181/a?b')).toBe(true);
    expect(re.test('http://localhost:5181')).toBe(true);
    expect(re.test('http://localhost:51810/')).toBe(false);
    expect(re.test('http://localhost:5181.evil.com/')).toBe(false);
    expect(new RegExp(originRegex('https://loja.com')).test('https://lojaXcom/')).toBe(false);
  });
});

test('parseStart só aceita origin http(s) puro e campos obrigatórios', () => {
  expect(parseStart(req)).toEqual(req);
  expect(parseStart({ ...req, siteOrigin: 'https://loja.com/caminho' })).toBeNull();
  expect(parseStart({ ...req, siteOrigin: 'javascript:alert(1)' })).toBeNull();
  expect(parseStart({ ...req, token: 1 })).toBeNull();
  expect(parseStart(null)).toBeNull();
});

describe('sessões', () => {
  test('uma regra por aba; renovar reaproveita; fechar remove', async () => {
    const c = fakeChrome();
    const s = createSessions(c.store, c.dnr);
    const a = await s.start(10, req);
    const b = await s.start(11, { ...req, siteOrigin: 'https://outra.com' });
    expect(a.ruleId).not.toBe(b.ruleId);
    expect(c.rules.size).toBe(2);
    expect((await s.start(10, req)).ruleId).toBe(a.ruleId);
    expect(c.rules.size).toBe(2);
    await s.end(10);
    expect([...c.rules.keys()]).toEqual([b.ruleId]);
  });

  test('frame só recebe a sessão na aba certa e no origin certo', async () => {
    const c = fakeChrome();
    const s = createSessions(c.store, c.dnr);
    await s.start(10, req);
    expect(await s.forFrame(10, 'https://loja.com')).toMatchObject({ token: 't' });
    expect(await s.forFrame(99, 'https://loja.com')).toBeNull(); // outra aba
    expect(await s.forFrame(10, 'https://evil.com')).toBeNull(); // outro site
    expect(await s.forFrame(undefined, 'https://loja.com')).toBeNull();
  });

  test('expira em 15 min e remove a regra', async () => {
    let now = 0;
    const c = fakeChrome();
    const s = createSessions(c.store, c.dnr, () => now);
    await s.start(10, req);
    now += SESSION_TTL_MS + 1;
    expect(await s.forFrame(10, 'https://loja.com')).toBeNull();
    expect(c.rules.size).toBe(0);
  });
});
