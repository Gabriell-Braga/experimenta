import { matchUrl } from '@abtest/snippet/segment';
import {
  ExperimentSchema,
  MvtSectionSchema,
  mvtVariations,
  pageOfOperation,
  type CampaignType,
  type Experiment,
  type FunnelPage,
  type MvtSection,
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
  /** Várias de uma vez (variação por IA): um passo só no desfazer. */
  | { type: 'addOperations'; drafts: OperationDraft[] }
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
      patch: Partial<
        Pick<
          Experiment,
          'name' | 'status' | 'traffic' | 'segmentation' | 'goals' | 'allocation' | 'audiences' | 'stats'
        >
      >;
    }
  | { type: 'setWeight'; id: string; weight: number }
  /** MVT: seções e opções (as combinações são regeneradas a cada mudança). */
  | { type: 'addSection' }
  | { type: 'addOption'; sectionId: string }
  | { type: 'renameMvt'; id: string; name: string }
  | { type: 'removeMvt'; id: string }
  /** Redirecionamento (URL dividida) e outros campos de uma variação. */
  | { type: 'patchVariation'; id: string; patch: Partial<Pick<Variation, 'redirect' | 'name'>> }
  /**
   * Teste multipágina: adiciona `url` como página do funil (a 1ª vez transforma o teste em multipágina, com a
   * página aberta como 1ª). Remover a última página volta a página única (as alterações dela ficam).
   */
  | { type: 'addPage'; url: string }
  | { type: 'patchPage'; id: string; patch: Partial<Pick<FunnelPage, 'name' | 'match'>> }
  | { type: 'removePage'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' };

const HISTORY_LIMIT = 100;

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** Chave legível a partir do nome + sufixo aleatório (única por conta). */
export const keyFrom = (name: string) =>
  `${
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'experimento'
  }-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Experimento novo por tipo de campanha. `splitUrl` = página da variação no teste de URL dividida.
 * MVT começa com uma seção (original + 1 opção); as variações são geradas pelas combinações.
 */
export function newExperiment(
  url: string,
  name = 'Experimento 1',
  type: CampaignType = 'ab',
  opts: { splitUrl?: string } = {},
): Experiment {
  const base = {
    id: uid('exp'),
    key: keyFrom(name),
    name,
    type,
    segmentation: { urls: [{ match: 'exact', value: url }] },
  };
  const v = (key: string, vname: string, weight: number, extra: object = {}) => ({
    id: uid('var'),
    key,
    name: vname,
    weight,
    ...extra,
  });
  if (type === 'mvt') {
    const sections = [
      {
        id: uid('sec'),
        name: 'Seção 1',
        options: [
          { id: uid('opt'), name: 'Original' },
          { id: uid('opt'), name: 'Opção 1' },
        ],
      },
    ];
    const parsed = MvtSectionSchema.array().parse(sections);
    return ExperimentSchema.parse({ ...base, sections: parsed, variations: mvtVariations(parsed, []) });
  }
  const variations =
    type === 'personalization'
      ? [v('holdout', 'Grupo de controle', 10), v('experiencia', 'Experiência', 90)]
      : type === 'rollout'
        ? [v('rollout', 'Rollout', 100)]
        : type === 'split'
          ? [
              v('controle', 'Controle', 50),
              v('variacao-1', 'Variação 1', 50, {
                redirect: { url: opts.splitUrl || url, preserveQuery: true },
              }),
            ]
          : type === 'server'
            ? [
                v('controle', 'Controle', 50, { variables: {} }),
                v('variacao-1', 'Variação 1', 50, { variables: {} }),
              ]
            : [v('controle', 'Controle', 50), v('variacao-1', 'Variação 1', 50)];
  return ExperimentSchema.parse({
    ...base,
    // Rollout começa gradual: 10% do tráfego.
    ...(type === 'rollout' ? { traffic: 10 } : {}),
    ...(type === 'server' ? { segmentation: {} } : {}),
    variations,
  });
}

export function initialState(experiment: Experiment, url: string): EditorState {
  return {
    experiment,
    url,
    // Começa na primeira variação que não é o controle (no MVT, na 1ª opção alternativa da 1ª seção).
    activeVariationId:
      experiment.type === 'mvt' && experiment.sections?.[0]
        ? (experiment.sections[0].options[1] ?? experiment.sections[0].options[0]!).id
        : (experiment.variations[1] ?? experiment.variations[0]!).id,
    past: [],
    future: [],
    dirty: false,
  };
}

type MvtOption = MvtSection['options'][number];
/** No MVT o editor trabalha numa OPÇÃO de seção; ela aparece como "variação" (mesmo objeto enquanto não muda). */
const optionViews = new WeakMap<MvtOption, Variation>();
const optionAsVariation = (o: MvtOption): Variation => {
  let v = optionViews.get(o);
  if (!v)
    optionViews.set(
      o,
      (v = {
        id: o.id,
        key: o.id,
        name: o.name,
        weight: 0,
        operations: o.operations,
        customCSS: o.customCSS,
        customJS: '',
      }),
    );
  return v;
};
export const findOption = (exp: Experiment, id: string) => {
  for (const s of exp.sections ?? []) {
    const o = s.options.find((x) => x.id === id);
    if (o) return { section: s, option: o };
  }
  return null;
};

/** Seções alteradas → variações (combinações) regeneradas. */
export const withSections = (exp: Experiment, sections: MvtSection[]): Experiment => ({
  ...exp,
  sections,
  variations: mvtVariations(sections, exp.variations),
});

export const activeVariation = (s: EditorState): Variation => {
  if (s.experiment.type === 'mvt') {
    const f = findOption(s.experiment, s.activeVariationId);
    if (f) return optionAsVariation(f.option);
  }
  return s.experiment.variations.find((v) => v.id === s.activeVariationId) ?? s.experiment.variations[0]!;
};

/** Tipos de campanha que podem ser multipágina (MVT, URL dividida e server-side não). */
export const canFunnel = (exp: Experiment) => ['ab', 'personalization', 'rollout'].includes(exp.type);

/** Teste multipágina: página do funil aberta no iframe (a 1ª cuja regra casa com a URL, como no snippet). */
export const currentPage = (s: EditorState): FunnelPage | undefined =>
  s.experiment.pages?.find((p) => matchUrl(p.match, s.url));

/** Filtro das operações que valem em `page` (todas, fora de teste multipágina). */
export const onPage = (exp: Pick<Experiment, 'pages'>, page: string | undefined) => (o: Operation) =>
  !exp.pages?.length || (page !== undefined && pageOfOperation(exp, o) === page);

/** Operações da variação ativa que valem na página aberta (todas, fora de teste multipágina). */
export const pageOperations = (s: EditorState): Operation[] =>
  activeVariation(s).operations.filter(onPage(s.experiment, currentPage(s)?.id));

/** Campos que a operação mantém quando o rascunho a substitui (o agent não conhece a página). */
const keep = (o: Operation) => ({ id: o.id, order: o.order, ...(o.page ? { page: o.page } : {}) });

/** Renumera `order` conforme a posição (a lista é a ordem de aplicação). */
const renumber = (ops: Operation[]) => ops.map((o, i) => (o.order === i ? o : { ...o, order: i }));

function editVariation(s: EditorState, fn: (v: Variation) => Variation): Experiment {
  const cur = activeVariation(s);
  const next = fn(cur);
  if (next === cur) return s.experiment; // nada mudou: não entra no histórico
  const f = s.experiment.type === 'mvt' ? findOption(s.experiment, cur.id) : null;
  if (f)
    return withSections(
      s.experiment,
      s.experiment.sections!.map((sec) =>
        sec !== f.section
          ? sec
          : {
              ...sec,
              options: sec.options.map((o) =>
                o === f.option ? { ...o, operations: next.operations, customCSS: next.customCSS } : o,
              ),
            },
      ),
    );
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
      return s.experiment.variations.some((v) => v.id === a.id) || findOption(s.experiment, a.id)
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
      return reducer(s, { type: 'addOperations', drafts: [a.draft] });
    case 'addOperations': {
      const page = currentPage(s)?.id;
      // Multipágina fora de qualquer página do funil: a alteração não teria onde valer.
      if ((s.experiment.pages?.length && !page) || !a.drafts.length) return s;
      return commit(
        s,
        editVariation(s, (v) => ({
          ...v,
          operations: renumber([
            ...v.operations,
            ...a.drafts.map(
              (d) => ({ ...d, id: uid('op'), order: 0, ...(page ? { page } : {}) }) as Operation,
            ),
          ]),
        })),
      );
    }
    case 'upsertOperation': {
      const page = currentPage(s)?.id;
      if (s.experiment.pages?.length && !page) return s;
      return commit(
        s,
        editVariation(s, (v) => {
          const prev = findEquivalent(v.operations.filter(onPage(s.experiment, page)), a.draft);
          if (!prev)
            return {
              ...v,
              operations: [
                ...v.operations,
                {
                  ...a.draft,
                  id: uid('op'),
                  order: v.operations.length,
                  ...(page ? { page } : {}),
                } as Operation,
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
            operations: v.operations.map((o) => (o === prev ? ({ ...next, ...keep(o) } as Operation) : o)),
          };
        }),
        a.coalesceKey,
      );
    }
    case 'updateOperation':
      return commit(
        s,
        editVariation(s, (v) => ({
          ...v,
          operations: v.operations.map((o) =>
            o.id === a.id ? ({ ...a.draft, ...keep(o) } as Operation) : o,
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
    case 'addSection': {
      const secs = s.experiment.sections ?? [];
      const opt = { id: uid('opt'), name: 'Opção 1', operations: [], customCSS: '' };
      const sec: MvtSection = {
        id: uid('sec'),
        name: `Seção ${secs.length + 1}`,
        options: [{ id: uid('opt'), name: 'Original', operations: [], customCSS: '' }, opt],
      };
      return { ...commit(s, withSections(s.experiment, [...secs, sec])), activeVariationId: opt.id };
    }
    case 'addOption': {
      const opt = { id: uid('opt'), name: '', operations: [], customCSS: '' };
      const secs = (s.experiment.sections ?? []).map((sec) =>
        sec.id === a.sectionId
          ? { ...sec, options: [...sec.options, { ...opt, name: `Opção ${sec.options.length}` }] }
          : sec,
      );
      return { ...commit(s, withSections(s.experiment, secs)), activeVariationId: opt.id };
    }
    case 'renameMvt':
      return commit(
        s,
        withSections(
          s.experiment,
          (s.experiment.sections ?? []).map((sec) =>
            sec.id === a.id
              ? { ...sec, name: a.name }
              : { ...sec, options: sec.options.map((o) => (o.id === a.id ? { ...o, name: a.name } : o)) },
          ),
        ),
      );
    case 'removeMvt': {
      // Seção inteira (se sobrar ao menos uma) ou opção alternativa (o original e o mínimo de 2 ficam).
      const secs = s.experiment.sections ?? [];
      const next = secs
        .filter((sec) => sec.id !== a.id || secs.length === 1)
        .map((sec) =>
          sec.options.length > 2
            ? { ...sec, options: sec.options.filter((o, i) => i === 0 || o.id !== a.id) }
            : sec,
        );
      const st = commit(s, withSections(s.experiment, next));
      return findOption(st.experiment, st.activeVariationId)
        ? st
        : { ...st, activeVariationId: next[0]!.options[1]!.id };
    }
    case 'patchVariation':
      return commit(s, {
        ...s.experiment,
        variations: s.experiment.variations.map((v) => (v.id === a.id ? { ...v, ...a.patch } : v)),
      });
    case 'addPage': {
      const exp = s.experiment;
      const pages = exp.pages ?? [];
      if (!canFunnel(exp) || pages.some((p) => matchUrl(p.match, a.url))) return s;
      const inc = exp.segmentation.urls.filter((r) => !r.exclude);
      // 1ª página: herda a regra da segmentação se ela era uma só (ex.: "contém /produto/").
      const match =
        !pages.length && inc.length === 1 && matchUrl(inc[0]!, a.url)
          ? inc[0]!
          : { match: 'exact' as const, value: a.url, exclude: false };
      const page: FunnelPage = { id: uid('pg'), name: `Página ${pages.length + 1}`, url: a.url, match };
      return commit(s, {
        ...exp,
        pages: [...pages, page],
        // As inclusões da segmentação passam a ser as páginas; exclusões continuam valendo.
        segmentation: { ...exp.segmentation, urls: exp.segmentation.urls.filter((r) => r.exclude) },
      });
    }
    case 'patchPage':
      return commit(s, {
        ...s.experiment,
        pages: s.experiment.pages?.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)),
      });
    case 'removePage': {
      const exp = s.experiment;
      const pages = exp.pages ?? [];
      const gone = pages.find((p) => p.id === a.id);
      if (!gone) return s;
      if (pages.length === 1)
        return commit(s, {
          ...exp,
          pages: undefined,
          segmentation: {
            ...exp.segmentation,
            urls: [{ ...gone.match, exclude: false }, ...exp.segmentation.urls.filter((r) => r.exclude)],
          },
          variations: exp.variations.map((v) => ({
            ...v,
            operations: v.operations.map(({ page: _p, ...o }) => o as Operation),
          })),
        });
      // As alterações da página saem junto (em todas as variações).
      return commit(s, {
        ...exp,
        pages: pages.filter((p) => p !== gone),
        variations: exp.variations.map((v) => ({
          ...v,
          operations: renumber(v.operations.filter((o) => pageOfOperation(exp, o) !== gone.id)),
        })),
      });
    }
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
