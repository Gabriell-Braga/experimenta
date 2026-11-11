import { expect, test } from 'vitest';
import { newExperiment } from '../store';
import { configWarnings, stepMissing } from './SettingsPanel';

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

test('avisos da configuração: variação sem alteração, peso 0 e tráfego 0', () => {
  const e = newExperiment('http://localhost:5180/');
  expect(configWarnings(e)).toEqual(['"Variação 1" não tem alteração: é igual ao controle.']);
  e.variations[1]!.customCSS = 'h1{color:red}';
  e.variations[0]!.weight = 0;
  e.traffic = 0;
  expect(configWarnings(e)).toEqual([
    'Tráfego em 0%: ninguém entra no teste.',
    '"Controle" está com peso 0%: nenhum visitante a recebe.',
  ]);
});
