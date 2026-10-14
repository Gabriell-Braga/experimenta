import type { OperationDraft } from '@abtest/shared';
import { describe, expect, test } from 'vitest';
import {
  activeVariation,
  initialState,
  newExperiment,
  reducer,
  type Action,
  type EditorState,
} from './store';

const URL_ = 'http://localhost:5180/';
const draft = (value: string): OperationDraft => ({
  type: 'setText',
  target: { selector: '#t', alternates: [] },
  value,
});
const run = (s: EditorState, ...actions: Action[]) => actions.reduce(reducer, s);
const start = () => initialState(newExperiment(URL_), URL_);

describe('store do editor', () => {
  test('experimento novo: controle + variação 1, aba ativa = variação 1, segmentação na URL', () => {
    const s = start();
    expect(s.experiment.variations.map((v) => v.name)).toEqual(['Controle', 'Variação 1']);
    expect(activeVariation(s).name).toBe('Variação 1');
    expect(s.experiment.segmentation.urls).toEqual([{ match: 'exact', value: URL_, exclude: false }]);
  });

  test('operações: adicionar numera; mover reordena e renumera; remover', () => {
    let s = run(
      start(),
      { type: 'addOperation', draft: draft('a') },
      { type: 'addOperation', draft: draft('b') },
    );
    let ops = activeVariation(s).operations;
    expect(ops.map((o) => [o.order, (o as { value: string }).value])).toEqual([
      [0, 'a'],
      [1, 'b'],
    ]);
    s = reducer(s, { type: 'moveOperation', id: ops[1]!.id, to: 0 });
    ops = activeVariation(s).operations;
    expect(ops.map((o) => [o.order, (o as { value: string }).value])).toEqual([
      [0, 'b'],
      [1, 'a'],
    ]);
    s = reducer(s, { type: 'removeOperation', id: ops[0]!.id });
    expect(activeVariation(s).operations.map((o) => o.order)).toEqual([0]);
    expect(s.dirty).toBe(true);
  });

  test('desfazer/refazer; nova mudança limpa o refazer; trocar de aba não entra no histórico', () => {
    let s = run(
      start(),
      { type: 'addOperation', draft: draft('a') },
      { type: 'setCustom', field: 'customCSS', value: 'h1{}' },
    );
    s = reducer(s, { type: 'undo' });
    expect(activeVariation(s).customCSS).toBe('');
    expect(activeVariation(s).operations).toHaveLength(1);
    s = reducer(s, { type: 'redo' });
    expect(activeVariation(s).customCSS).toBe('h1{}');
    s = run(s, { type: 'undo' }, { type: 'addOperation', draft: draft('c') });
    expect(s.future).toEqual([]);
    const before = s.past.length;
    s = reducer(s, { type: 'selectVariation', id: s.experiment.variations[0]!.id });
    expect(s.past.length).toBe(before);
    expect(reducer({ ...s, past: [] }, { type: 'undo' }).experiment).toBe(s.experiment);
  });

  test('operações vão só para a variação ativa', () => {
    let s = start();
    const control = s.experiment.variations[0]!.id;
    s = run(s, { type: 'addOperation', draft: draft('a') }, { type: 'addVariation' });
    expect(activeVariation(s).name).toBe('Variação 2');
    s = run(s, { type: 'addOperation', draft: draft('x') }, { type: 'selectVariation', id: control });
    expect(activeVariation(s).operations).toEqual([]);
    expect(s.experiment.variations.map((v) => v.operations.length)).toEqual([0, 1, 1]);
  });

  test('updateOperation mantém id e ordem; setCustom igual não suja o histórico', () => {
    let s = reducer(start(), { type: 'addOperation', draft: draft('a') });
    const op = activeVariation(s).operations[0]!;
    s = reducer(s, { type: 'updateOperation', id: op.id, draft: draft('z') });
    expect(activeVariation(s).operations[0]).toMatchObject({ id: op.id, order: 0, value: 'z' });
    const len = s.past.length;
    s = reducer(s, { type: 'setCustom', field: 'customJS', value: '' });
    expect(s.past.length).toBe(len);
  });
});

describe('upsert (painel de propriedades)', () => {
  const style = (value: Record<string, string>): OperationDraft => ({
    type: 'setStyle',
    target: { selector: '.btn', alternates: [] },
    value,
  });

  test('setStyle no mesmo alvo faz merge numa única operação', () => {
    const s = run(
      start(),
      { type: 'upsertOperation', draft: style({ color: 'red' }) },
      { type: 'upsertOperation', draft: style({ 'font-size': '20px' }) },
      { type: 'upsertOperation', draft: style({ color: 'blue' }) },
    );
    expect(activeVariation(s).operations).toHaveLength(1);
    expect(activeVariation(s).operations[0]).toMatchObject({ value: { color: 'blue', 'font-size': '20px' } });
    expect(s.past).toHaveLength(3);
  });

  test('setAttribute por nome; alvo diferente cria outra operação', () => {
    const attr = (name: string, value: string, selector = '.btn'): OperationDraft => ({
      type: 'setAttribute',
      target: { selector, alternates: [] },
      value: { name, value },
    });
    const s = run(
      start(),
      { type: 'upsertOperation', draft: attr('href', '/a') },
      { type: 'upsertOperation', draft: attr('title', 'x') },
      { type: 'upsertOperation', draft: attr('href', '/b') },
      { type: 'upsertOperation', draft: attr('href', '/c', '#outro') },
    );
    expect(activeVariation(s).operations.map((o) => (o as { value: { value: string } }).value.value)).toEqual(
      ['/b', 'x', '/c'],
    );
  });

  test('coalesceKey junta edições seguidas numa entrada do histórico', () => {
    let s = start();
    for (const c of ['#100000', '#200000', '#300000'])
      s = reducer(s, { type: 'upsertOperation', draft: style({ color: c }), coalesceKey: 'color' });
    expect(s.past).toHaveLength(1);
    s = reducer(s, { type: 'undo' });
    expect(activeVariation(s).operations).toEqual([]);
  });
});
