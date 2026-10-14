import { expect, test } from 'vitest';
import { VERSION } from './index';

test('exporta versão', () => {
  expect(VERSION).toBe('0.0.0');
});
