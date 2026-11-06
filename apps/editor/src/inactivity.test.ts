import { describe, expect, it } from 'vitest';
import { inactiveGaps, skipTarget } from './inactivity';

describe('inactiveGaps', () => {
  const ev = (timestamp: number, type: number, source?: number) => ({ timestamp, type, data: { source } });

  it('pula trechos sem interação, ignorando mutações, e o fim parado', () => {
    const gaps = inactiveGaps(
      [ev(1000, 2), ev(1500, 3, 1), ev(4000, 3, 0), ev(9000, 3, 2), ev(10000, 3, 3)],
      1000,
      20000,
    );
    // 0,5 s → 8 s sem interação (mutação em 3 s não conta); 9 s → fim (20 s) parado.
    expect(gaps).toEqual([
      [500, 7200],
      [9000, 20000],
    ]);
    expect(skipTarget(gaps, 2000)).toBe(7200);
    expect(skipTarget(gaps, 6500)).toBeNull(); // já perto da próxima interação
    expect(skipTarget(gaps, 8500)).toBeNull();
  });
});
