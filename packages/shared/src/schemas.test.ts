import { describe, expect, test } from 'vitest';
import {
  ExperimentSchema,
  OPERATION_TYPES,
  OperationSchema,
  PublishedConfigSchema,
  TrackingEventSchema,
  type Operation,
} from './index';

const target = { selector: '#hero-title' };

const ops: Record<string, unknown> = {
  setText: 'Novo título',
  setHTML: '<b>oi</b>',
  setStyle: { color: 'red', 'font-size': '20px' },
  setAttribute: { name: 'href', value: null },
  addClass: 'destaque',
  removeClass: 'btn',
  hide: undefined,
  remove: undefined,
  move: { position: 'after', anchor: { selector: '.hero-subtitle' } },
  insertHTML: { position: 'before', html: '<p>novo</p>' },
  replaceImage: { src: '/tenis-vermelho.svg', alt: 'Tênis vermelho' },
};

const experiment = {
  id: 'e1',
  key: 'hero-test',
  name: 'Teste do hero',
  variations: [
    { id: 'v0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'v1',
      key: 'b',
      name: 'Variação B',
      weight: 50,
      operations: [{ id: 'o1', order: 0, type: 'setText', target, value: 'Corra mais' }],
    },
  ],
  goals: [{ id: 'g1', key: 'compra', type: 'click', selector: '[data-testid=cta-comprar]' }],
};

describe('OperationSchema', () => {
  test('cobre todos os tipos de operação do plano', () => {
    expect(OPERATION_TYPES.sort()).toEqual(Object.keys(ops).sort());
  });

  test.each(Object.entries(ops))('aceita %s', (type, value) => {
    const op = OperationSchema.parse({ id: 'x', order: 0, type, target, value });
    expect(op.type).toBe(type);
    expect(op.target.alternates).toEqual([]);
  });

  test('rejeita tipo desconhecido e valor inválido', () => {
    expect(OperationSchema.safeParse({ id: 'x', order: 0, type: 'explode', target }).success).toBe(false);
    expect(OperationSchema.safeParse({ id: 'x', order: 0, type: 'setText', target, value: 1 }).success).toBe(
      false,
    );
    expect(
      OperationSchema.safeParse({ id: 'x', order: 0, type: 'move', target, value: { position: 'up' } })
        .success,
    ).toBe(false);
  });

  test('narrowing por tipo funciona no TypeScript', () => {
    const op: Operation = OperationSchema.parse({ id: 'x', order: 0, type: 'setStyle', target, value: {} });
    if (op.type === 'setStyle') expect(op.value).toEqual({});
  });
});

describe('ExperimentSchema', () => {
  test('aplica defaults', () => {
    const e = ExperimentSchema.parse(experiment);
    expect(e.status).toBe('draft');
    expect(e.traffic).toBe(100);
    expect(e.antiFlicker).toEqual({ mode: 'element', timeoutMs: 1500 });
    expect(e.segmentation).toEqual({ urls: [], devices: [], query: [], visitor: 'all' });
    expect(e.variations[0]!.customCSS).toBe('');
  });

  test('rejeita chaves repetidas, pesos zerados e chave inválida', () => {
    const dup = { ...experiment, variations: [experiment.variations[0], experiment.variations[0]] };
    expect(ExperimentSchema.safeParse(dup).success).toBe(false);
    const zero = { ...experiment, variations: experiment.variations.map((v) => ({ ...v, weight: 0 })) };
    expect(ExperimentSchema.safeParse(zero).success).toBe(false);
    expect(ExperimentSchema.safeParse({ ...experiment, key: 'Com Espaço' }).success).toBe(false);
  });
});

test('PublishedConfigSchema', () => {
  const cfg = PublishedConfigSchema.parse({
    accountId: 'acc1',
    version: 1,
    publishedAt: new Date().toISOString(),
    experiments: [experiment],
  });
  expect(cfg.experiments).toHaveLength(1);
});

test('TrackingEventSchema valida selector_healed', () => {
  const ev = {
    eventId: 'ev1',
    ts: Date.now(),
    accountId: 'acc1',
    visitorId: 'vis1',
    url: 'http://x/',
    experimentId: 'e1',
    experimentKey: 'hero-test',
    variationId: 'v1',
    variationKey: 'b',
    type: 'selector_healed',
    operationId: 'o1',
    selector: '#velho',
    healedSelector: '#novo',
    via: 'fingerprint',
  };
  expect(TrackingEventSchema.parse(ev).type).toBe('selector_healed');
  expect(TrackingEventSchema.safeParse({ ...ev, via: 'magia' }).success).toBe(false);
});
