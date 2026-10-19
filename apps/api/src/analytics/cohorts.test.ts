import type { TrackingEvent } from '@abtest/shared';
import { expect, test } from 'vitest';
import { bucketStart, cohortsReport } from './cohorts';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 9, 5); // segunda-feira, 5/10/2026
const pv = (v: string, ts: number) =>
  ({ type: 'pageview', visitorId: v, ts, url: 'x', device: 'desktop' }) as TrackingEvent;
const evn = (v: string, ts: number, name = 'compra') =>
  ({ type: 'event', visitorId: v, ts, url: 'x', name }) as TrackingEvent;

test('semana começa na segunda (UTC)', () => {
  expect(bucketStart(MON + 3 * DAY + 5000, 'week')).toBe(MON);
  expect(bucketStart(MON - 1, 'week')).toBe(MON - 7 * DAY);
  expect(bucketStart(MON + 3 * DAY + 5000, 'day')).toBe(MON + 3 * DAY);
});

test('retenção semanal e conversão acumulada por coorte', () => {
  const events = [
    pv('a', MON),
    pv('a', MON + 8 * DAY),
    evn('a', MON + 9 * DAY), // semana 0 → volta na 1
    pv('b', MON + DAY), // semana 0, não volta
    pv('c', MON + 7 * DAY),
    pv('c', MON + 21 * DAY),
    evn('c', MON + 7 * DAY), // semana 1 → volta na 2 (idx 2)
  ];
  const now = MON + 22 * DAY;
  const r = cohortsReport(events, { unit: 'week', metric: 'retention', periods: 4, now });
  expect(r.cohorts.map((c) => [c.start, c.size])).toEqual([
    ['2026-10-05', 2],
    ['2026-10-12', 1],
  ]);
  expect(r.cohorts[0]!.values.map((v) => v?.rate ?? null)).toEqual([1, 0.5, 0, 0]);
  expect(r.cohorts[1]!.values.map((v) => v?.rate ?? null)).toEqual([1, 0, 1, null]); // semana 3 ainda não chegou
  const conv = cohortsReport(events, { unit: 'week', metric: 'event', event: 'compra', periods: 3, now });
  expect(conv.cohorts[0]!.values.map((v) => v?.count)).toEqual([0, 1, 1]);
  expect(conv.cohorts[1]!.values.map((v) => v?.count)).toEqual([1, 1, 1]);
});
