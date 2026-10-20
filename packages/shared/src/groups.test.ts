import { expect, test } from 'vitest';
import { allocateSlots, GroupSchema } from './entities';

const count = (s: string[], id: string) => s.filter((x) => x === id).length;

test('allocateSlots: fatias contíguas na 1ª vez; mudar o grupo só move a diferença', () => {
  const s1 = allocateSlots(undefined, [
    { id: 'a', percent: 50 },
    { id: 'b', percent: 30 },
  ]);
  expect(s1.slice(0, 50).every((x) => x === 'a')).toBe(true);
  expect(s1.slice(50, 80).every((x) => x === 'b')).toBe(true);
  expect(count(s1, '')).toBe(20);

  // a sai, c entra com 60: b não se mexe; c pega as livres de menor índice.
  const s2 = allocateSlots(s1, [
    { id: 'b', percent: 30 },
    { id: 'c', percent: 60 },
  ]);
  s1.forEach((o, i) => o === 'b' && expect(s2[i]).toBe('b'));
  expect(count(s2, 'c')).toBe(60);
  expect(count(s2, 'a')).toBe(0);
  // b diminui: perde as fatias do fim; o resto de c fica onde estava.
  const s3 = allocateSlots(s2, [
    { id: 'b', percent: 10 },
    { id: 'c', percent: 60 },
  ]);
  expect(s3.slice(50, 60).every((x) => x === 'b')).toBe(true);
  expect(s3.slice(60, 80).every((x) => x === '')).toBe(true);
  s2.forEach((o, i) => o === 'c' && expect(s3[i]).toBe('c'));
  // Mesma entrada → mesma saída (idempotente).
  expect(
    allocateSlots(s3, [
      { id: 'b', percent: 10 },
      { id: 'c', percent: 60 },
    ]),
  ).toEqual(s3);
});

test('GroupSchema: soma até 100 e sem repetidos', () => {
  expect(GroupSchema.safeParse({ experiments: [{ id: 'a', percent: 100 }] }).success).toBe(true);
  expect(
    GroupSchema.safeParse({
      experiments: [
        { id: 'a', percent: 60 },
        { id: 'b', percent: 41 },
      ],
    }).success,
  ).toBe(false);
  expect(
    GroupSchema.safeParse({
      experiments: [
        { id: 'a', percent: 1 },
        { id: 'a', percent: 1 },
      ],
    }).success,
  ).toBe(false);
  expect(GroupSchema.safeParse({ experiments: [{ id: 'a', percent: 0 }] }).success).toBe(false);
});
