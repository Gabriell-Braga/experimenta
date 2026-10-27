import { expect, test } from 'vitest';
import { newExperiment } from '../store';
import { stepMissing } from './SettingsPanel';

test('passos da configuração: hipótese → variação com alteração → meta', () => {
  const e = newExperiment('http://localhost:5180/');
  expect(stepMissing(e, 'hypothesis')).toMatch(/hipótese/);
  e.hypothesis = 'Se X, então Y';
  expect(stepMissing(e, 'hypothesis')).toBe('');
  expect(stepMissing(e, 'variation')).toMatch(/alteração/);
  e.variations[1]!.customCSS = 'h1{color:red}';
  expect(stepMissing(e, 'variation')).toBe('');
  expect(stepMissing(e, 'goals')).toMatch(/meta/);
  expect(stepMissing(e, 'qa')).toBe('');
});
