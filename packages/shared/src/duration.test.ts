import { expect, test } from 'vitest';
import { MAX_USEFUL_DAYS, remainingDuration } from './duration';

test('duração restante: ok até 8 semanas, longa demais acima, desconhecida sem estimativa', () => {
  expect(remainingDuration(null)).toEqual({ kind: 'unknown' });
  expect(remainingDuration(NaN)).toEqual({ kind: 'unknown' });
  expect(remainingDuration(-1)).toEqual({ kind: 'unknown' });
  expect(remainingDuration(0)).toEqual({ kind: 'ok', days: 0 });
  expect(remainingDuration(12.2)).toEqual({ kind: 'ok', days: 13 });
  expect(remainingDuration(MAX_USEFUL_DAYS)).toEqual({ kind: 'ok', days: 56 });
  expect(remainingDuration(57)).toEqual({ kind: 'too-long' });
  expect(remainingDuration(10658)).toEqual({ kind: 'too-long' });
});
