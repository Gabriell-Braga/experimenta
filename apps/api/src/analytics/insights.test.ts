import { ExperimentSchema, FunnelSchema, type TrackingEvent } from '@abtest/shared';
import { expect, test } from 'vitest';
import { formsReport } from './forms';
import { findInsights } from './insights';
import { pagesReport } from './pages';

const to = new Date(Date.UTC(2026, 9, 19));
const range = { from: new Date(to.getTime() - 14 * 86_400_000), to };
const T = to.getTime() - 86_400_000;
const exp = (weights = [50, 50]) =>
  ExperimentSchema.parse({
    id: 'e1',
    key: 'hero',
    name: 'Hero',
    status: 'running',
    variations: [
      { id: 'a', key: 'a', name: 'Controle', weight: weights[0] },
      { id: 'b', key: 'b', name: 'B', weight: weights[1] },
    ],
    goals: [{ id: 'g', key: 'compra', type: 'custom', event: 'compra' }],
  });
const base = (v: string, ts = T) => ({ visitorId: v, sessionId: `s${v}`, ts, url: 'http://x.com/' });
const pv = (v: string, url: string, device = 'desktop', ts = T) =>
  ({ ...base(v, ts), type: 'pageview', url, device }) as TrackingEvent;

/**
 * n visitantes por variação; `conv(arm, i)` diz quem converte; dispositivo alterna por `device(i)`. Exposições
 * espalhadas por 9 dias (8 completos): passa da semana mínima para declarar vencedora.
 */
function traffic(
  n: number,
  conv: (arm: string, i: number, device: string) => boolean,
  device = (i: number) => (i % 2 ? 'mobile' : 'desktop'),
) {
  const out: TrackingEvent[] = [];
  for (const arm of ['a', 'b'])
    for (let i = 0; i < n; i++) {
      const v = `${arm}${i}`;
      const d = device(i);
      out.push(pv(v, 'http://x.com/', d));
      out.push({
        ...base(v, T + 1 - (i % 9) * 86_400_000),
        type: 'exposure',
        experimentId: 'e1',
        experimentKey: 'hero',
        variationId: arm,
        variationKey: arm,
      } as TrackingEvent);
      if (conv(arm, i, d))
        out.push({
          ...base(v, T + 2),
          type: 'conversion',
          experimentId: 'e1',
          experimentKey: 'hero',
          variationId: arm,
          variationKey: arm,
          goalId: 'g',
          goalKey: 'compra',
        } as TrackingEvent);
    }
  return out;
}
const run = (cur: TrackingEvent[], extra: Partial<Parameters<typeof findInsights>[0]> = {}) =>
  findInsights({
    cur,
    range,
    running: [exp()],
    funnels: [],
    pages: pagesReport(cur),
    forms: formsReport(cur),
    ...extra,
  });

test('vencedor declarado e segmento divergente por dispositivo', () => {
  // B: 95% vs 80% no total, com a amostra planejada (~326 por variação) e 8 dias completos → vence.
  const conv = (arm: string, i: number) => (arm === 'b' ? i % 20 < 19 : i % 10 < 8);
  const win = run(traffic(400, conv));
  expect(win.find((x) => x.kind === 'winner')).toMatchObject({
    severity: 'good',
    title: 'Hero: B venceu',
    detail: expect.stringContaining('+19% em compra'),
  });
  // 20.2: a mesma diferença com 100 visitantes por variação ainda é "coletando" (sem vencedora).
  expect(run(traffic(100, conv)).find((x) => x.kind === 'winner')).toBeUndefined();

  // B ganha no desktop (40% vs 10%) e perde no celular (10% vs 40%).
  const div = run(
    traffic(600, (arm, i, d) => ((arm === 'b') === (d === 'desktop') ? i % 10 < 4 : i % 10 < 1)),
  );
  expect(div.find((x) => x.kind === 'segment')).toMatchObject({
    title: 'Hero: B ganha no desktop e perde no celular',
    link: { view: 'report', params: { id: 'e1', device: 'mobile' } },
  });
  expect(div.find((x) => x.kind === 'winner')).toBeUndefined();
});

test('SRM vem primeiro (crítico)', () => {
  const cur = traffic(300, () => false).filter(
    (e) => !(e.visitorId.startsWith('b') && Number(e.visitorId.slice(1)) >= 200),
  );
  const r = run(cur);
  expect(r[0]).toMatchObject({ kind: 'srm', severity: 'critical' });
});

test('frustração, scroll baixo, campo de formulário e passo de funil', () => {
  const cur: TrackingEvent[] = [];
  for (let i = 0; i < 100; i++) {
    cur.push(pv(`v${i}`, 'http://x.com/carrinho'));
    cur.push({
      ...base(`v${i}`),
      type: 'scroll',
      url: 'http://x.com/carrinho',
      depth: 20,
    } as unknown as TrackingEvent);
    if (i < 10)
      cur.push({
        ...base(`v${i}`),
        type: 'frustration',
        kind: 'rage',
        url: 'http://x.com/carrinho',
      } as unknown as TrackingEvent);
    if (i < 20) cur.push({ ...pv(`v${i}`, 'http://x.com/checkout'), ts: T + 10 });
    cur.push({
      ...base(`v${i}`),
      type: 'form',
      url: 'http://x.com/carrinho',
      form: 'cadastro',
      variations: {},
      device: 'desktop',
      interacted: true,
      submitted: i >= 50,
      lastField: i < 40 ? 'cpf' : 'email',
      fields: [
        { name: 'email', kind: 'email', focus: 1, time: 1000, refills: 0, filled: true },
        { name: 'cpf', kind: 'text', focus: 1, time: 3000, refills: 0, filled: i >= 40 },
      ],
    } as unknown as TrackingEvent);
  }
  const funnel = FunnelSchema.parse({
    steps: [
      { name: 'Carrinho', type: 'url', url: { match: 'contains', value: '/carrinho' } },
      { name: 'Checkout', type: 'url', url: { match: 'contains', value: '/checkout' } },
    ],
  });
  const r = run(cur, { running: [], funnels: [{ id: 'f1', name: 'Compra', data: funnel }] });
  const kinds = r.map((x) => x.kind);
  expect(kinds).toEqual(expect.arrayContaining(['frustration', 'low-scroll', 'form-field', 'funnel-step']));
  expect(r.find((x) => x.kind === 'form-field')!.title).toBe('Campo "cpf" faz desistir do formulário');
  expect(r.find((x) => x.kind === 'funnel-step')!.title).toBe('Compra: 80% param antes de "Checkout"');
  expect(r.find((x) => x.kind === 'funnel-step')!.detail).toMatch(/A maioria sai do site\.$/);
  expect(r.at(-1)!.severity).toBe('info');
});

test('meta de guarda piorada: alerta crítico e a variação não é anunciada como vencedora', () => {
  const guarded = ExperimentSchema.parse({
    ...exp(),
    goals: [...exp().goals, { id: 'g2', key: 'retorno', type: 'custom', event: 'retorno' }],
    stats: { guardrails: ['g2'] },
  });
  // B vence a primária (95% vs 80%) mas derruba "retorno" (80% → 50%).
  const cur = traffic(400, (arm, i) => (arm === 'b' ? i % 20 < 19 : i % 10 < 8));
  for (const arm of ['a', 'b'])
    for (let i = 0; i < 400; i++)
      if (arm === 'a' ? i % 10 < 8 : i % 10 < 5)
        cur.push({
          ...base(`${arm}${i}`, T + 3),
          type: 'conversion',
          experimentId: 'e1',
          experimentKey: 'hero',
          variationId: arm,
          variationKey: arm,
          goalId: 'g2',
          goalKey: 'retorno',
        } as TrackingEvent);
  const r = run(cur, { running: [guarded] });
  expect(r.find((x) => x.kind === 'winner')).toBeUndefined();
  expect(r[0]).toMatchObject({
    kind: 'guardrail',
    severity: 'critical',
    title: 'Hero: B piora a meta de guarda retorno',
    link: { view: 'report', params: { id: 'e1', goal: 'g2' } },
  });
});
