import { expect, test } from 'vitest';
import { cdnOnly } from './worker';

test('domínio da CDN: só GET/HEAD em /cdn/*', () => {
  const r = (path: string, method = 'GET') => new Request(`https://experimenta-cdn.x${path}`, { method });
  expect(cdnOnly(r('/cdn/demo.js'))).toBe(true);
  expect(cdnOnly(r('/cdn/agent.js', 'HEAD'))).toBe(true);
  expect(cdnOnly(r('/experiments'))).toBe(false);
  expect(cdnOnly(r('/auth/login', 'POST'))).toBe(false);
  expect(cdnOnly(r('/cdn/demo.js', 'POST'))).toBe(false);
});
