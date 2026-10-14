import {
  ExperimentSchema,
  type Experiment,
  type Operation,
  type OperationDraft,
  type Variation,
} from '@abtest/shared';

export interface EditorState {
  experiment: Experiment;
  /** URL do site aberto no iframe (página em edição). */
  url: string;
  activeVariationId: string;
  past: Experiment[];
  future: Experiment[];
  dirty: boolean;
  /** Chave da última edição coalescível (ex.: arrastar o seletor de cor gera uma entrada só no histórico). */
  lastKey?: string;
}

export type Action =
  | { type: 'load'; experiment: Experiment; url: string }
  | { type: 'selectVariation'; id: string }
  | { type: 'addVariation' }
  | { type: 'renameVariation'; id: string; name: string }
  | { type: 'addOperation'; draft: OperationDraft }
  /** Cria ou atualiza a operação equivalente (mesmo alvo + tipo [+ atributo]); setStyle faz merge das propriedades. */
  | { type: 'upsertOperation'; draft: OperationDraft; coalesceKey?: string }
  | { type: 'updateOperation'; id: string; draft: OperationDraft }
  | { type: 'removeOperation'; id: string }
  | { type: 'moveOperation'; id: string; to: number }
  | { type: 'setCustom'; field: 'customCSS' | 'customJS'; value: string }
  | { type: 'setUrl'; url: string }
  /** Configurações do experimento (nome, status, tráfego, segmentação, metas). */
  | {
      type: 'patchExperiment';
      patch: Partial<Pick<Experiment, 'name' | 'status' | 'traffic' | 'segmentation' | 'goals'>>;
    }
  | { type: 'setWeight'; id: string; weight: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' };

const HISTORY_LIMIT = 100;

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export function newExperiment(url: string): Experiment {
  return ExperimentSchema.parse({
    id: uid('exp'),
    key: `experimento-${Date.now().toString(36)}`,
    name: 'Experimento 1',
    segmentation: { urls: [{ match: 'exact', value: url }] },
    variations: [
      { id: uid('var'), key: 'controle', name: 'Controle', weight: 50 },
      { id: uid('var'), key: 'variacao-1', name: 'Variação 1', weight: 50 },
    ],
  });
}

export function initialState(experiment: Experiment, url: string): EditorState {
  return {
    experiment,
    url,
    // Começa na primeira variação que não é o controle.
    activeVariationId: (experiment.variations[1] ?? experiment.variations[0]!).id,
    past: [],
    future: [],
    dirty: false,
  };
}

export const activeVariation = (s: EditorState): Variation =>
  s.experiment.variations.find((v) => v.id === s.activeVariationId) ?? s.experiment.variations[0]!;

/** Renumera `order` conforme a posição (a lista é a ordem de aplicação). */
const renumber = (ops: Operation[]) => ops.map((o, i) => (o.order === i ? o : { ...o, order: i }));

function editVariation(s: EditorState, fn: (v: Variation) => Variation): Experiment {
  const cur = activeVariation(s);
  const next = fn(cur);
  if (next === cur) return s.experiment; // nada mudou: não entra no histórico
  return { ...s.experiment, variations: s.experiment.variations.map((v) => (v === cur ? next : v)) };
}

/** Mudanças no experimento entram no histórico (desfazer/refazer); navegação de abas não. */
function commit(s: EditorState, experiment: Experiment, key?: string): EditorState {
  if (experiment === s.experiment) return s;
  // Mesma chave da edição anterior: substitui o estado atual sem nova entrada no histórico.
  const past = key && key === s.lastKey ? s.past : [...s.past, s.experiment].slice(-HISTORY_LIMIT);
  return { ...s, experiment, past, future: [], dirty: true, lastKey: key };
}

/** Operação já existente que a nova edição deve atualizar em vez de criar outra. */
export function findEquivalent(ops: Operation[], d: OperationDraft): Operation | undefined {
  return ops.find(
    (o) =>
      o.type === d.type &&
      o.target.selector === d.target.selector &&
      ['setStyle', 'setText', 'setHTML', 'setAttribute', 'replaceImage'].includes(o.type) &&
      (o.type !== 'setAttribute' || (d.type === 'setAttribute' && o.value.name === d.value.name)),
  );
}

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'load':
      return initialState(a.experiment, a.url);
    case 'selectVariation':
      return s.experiment.variations.some((v) => v.id === a.id)
        ? { ...s, activeVariationId: a.id, lastKey: undefined }
        : s;
    case 'addVariation': {
      const n = s.experiment.variations.length;
      const v: Variation = {
        id: uid('var'),
        key: `variacao-${n}`,
        name: `Variação ${n}`,
        weight: 50,
        operations: [],
        customCSS: '',
        customJS: '',
      };
      const next = commit(s, { ...s.experiment, variations: [...s.experiment.variations, v] });
      return { ...next, activeVariationId: v.id };
    }
    case 'renameVariation':
      return commit(s, {
        ...s.experiment,
        variations: s.experiment.variations.map((v) => (v.id === a.id ? { ...v, name: a.name } : v)),
      });
    case 'addOperation':
      return commit(
        s,
        editVariation(s, (v) => ({
          ...v,
          operations: renumber([
            ...v.operations,
            { ...a.draft, id: uid('op'), order: v.operations.length } as Operation,
          ]),
        })),
      );
    case 'upsertOperation':
      return commit(
        s,
        editVariation(s, (v) => {
          const prev = findEquivalent(v.operations, a.draft);
          if (!prev)
            return {
              ...v,
              operations: [
                ...v.operations,
                { ...a.draft, id: uid('op'), order: v.operations.length } as Operation,
              ],
            };
          // findEquivalent garante mesmo tipo; setStyle soma as propriedades.
          const next = (
            prev.type === 'setStyle' && a.draft.type === 'setStyle'
              ? { ...a.draft, value: { ...prev.value, ...a.draft.value } }
              : a.draft
          ) as OperationDraft;
          return {
            ...v,
            operations: v.operations.map((o) =>
              o === prev ? ({ ...next, id: o.id, order: o.order } as Operation) : o,
            ),
          };
        }),
        a.coalesceKey,
      );
    case 'updateOperation':
      return commit(
        s,
        editVariation(s, (v) => ({
          ...v,
          operations: v.operations.map((o) =>
            o.id === a.id ? ({ ...a.draft, id: o.id, order: o.order } as Operation) : o,
          ),
        })),
      );
    case 'removeOperation':
      return commit(
        s,
        editVariation(s, (v) => ({ ...v, operations: renumber(v.operations.filter((o) => o.id !== a.id)) })),
      );
    case 'moveOperation':
      return commit(
        s,
        editVariation(s, (v) => {
          const ops = [...v.operations];
          const from = ops.findIndex((o) => o.id === a.id);
          if (from < 0 || a.to < 0 || a.to >= ops.length || from === a.to) return v;
          ops.splice(a.to, 0, ops.splice(from, 1)[0]!);
          return { ...v, operations: renumber(ops) };
        }),
      );
    case 'setCustom':
      return commit(
        s,
        editVariation(s, (v) => (v[a.field] === a.value ? v : { ...v, [a.field]: a.value })),
        // Digitação contínua no editor de código vira uma entrada só no histórico.
        `custom:${a.field}`,
      );
    case 'patchExperiment':
      return commit(s, { ...s.experiment, ...a.patch });
    case 'setWeight':
      return commit(s, {
        ...s.experiment,
        variations: s.experiment.variations.map((v) =>
          v.id === a.id ? { ...v, weight: Math.max(0, Math.round(a.weight)) } : v,
        ),
      });
    case 'setUrl':
      return { ...s, url: a.url };
    case 'undo': {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {
        ...s,
        experiment: prev,
        past: s.past.slice(0, -1),
        future: [s.experiment, ...s.future],
        dirty: true,
        lastKey: undefined,
      };
    }
    case 'redo': {
      const next = s.future[0];
      if (!next) return s;
      return {
        ...s,
        experiment: next,
        past: [...s.past, s.experiment],
        future: s.future.slice(1),
        dirty: true,
        lastKey: undefined,
      };
    }
    case 'saved':
      return { ...s, dirty: false };
  }
}
