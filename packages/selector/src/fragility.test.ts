import { expect, test } from 'vitest';
import { selectorFragility } from './fragility';

test.each([
  ['#hero-title', 'low'],
  ['[data-testid="cta-comprar"]', 'low'],
  ['p.hero-subtitle', 'low'],
  ['a[href="/x y"]', 'low'],
  ['div.plan-featured p.price', 'medium'],
  ['main > section > div > p', 'medium'],
  ['h1', 'medium'],
  ['ul.feature-list > li:nth-of-type(2)', 'high'],
  ['.css-1x2y3z', 'high'],
  ['#a8f3c91e .price', 'high'],
  ['button.sc-bdVaJa', 'high'],
])('%s → %s', (sel, f) => expect(selectorFragility(sel)).toBe(f));
