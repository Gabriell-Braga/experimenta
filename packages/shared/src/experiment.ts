import { z } from 'zod';
import { OperationSchema } from './operations';

/** Chave legível usada em URLs (ex.: ?ab_force=experimento:variacao). */
export const KeySchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'use minúsculas, números, - e _');
/** Nome digitado pelo usuário: sem espaços nas pontas, não vazio, tamanho de título. */
export const NameSchema = z.string().trim().min(1, 'obrigatório').max(200);

export const UrlRuleSchema = z.object({
  match: z.enum(['exact', 'contains', 'regex']),
  value: z.string().min(1),
  exclude: z.boolean().default(false),
});
export type UrlRule = z.infer<typeof UrlRuleSchema>;

export const DeviceSchema = z.enum(['desktop', 'tablet', 'mobile']);
export type Device = z.infer<typeof DeviceSchema>;

export const SegmentationSchema = z.object({
  /** Vazio = qualquer URL. Inclusões em OU; exclusões vencem. */
  urls: z.array(UrlRuleSchema).default([]),
  /** Vazio = todos os dispositivos. */
  devices: z.array(DeviceSchema).default([]),
  /** Todos precisam bater. value ausente = só exige a presença do parâmetro. */
  query: z.array(z.object({ key: z.string().min(1), value: z.string().optional() })).default([]),
  visitor: z.enum(['all', 'new', 'returning']).default('all'),
});
export type Segmentation = z.infer<typeof SegmentationSchema>;

export const GoalSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), key: KeySchema, type: z.literal('click'), selector: z.string().min(1) }),
  z.object({ id: z.string(), key: KeySchema, type: z.literal('pageview'), url: UrlRuleSchema }),
  z.object({ id: z.string(), key: KeySchema, type: z.literal('formSubmit'), selector: z.string().min(1) }),
  /** Disparada por window.abq.push(['track', event]). */
  z.object({ id: z.string(), key: KeySchema, type: z.literal('custom'), event: z.string().min(1) }),
]);
export type Goal = z.infer<typeof GoalSchema>;

export const VariationSchema = z.object({
  id: z.string(),
  key: KeySchema,
  name: NameSchema,
  /** Peso relativo (inteiro). A distribuição é weight / soma dos pesos. */
  weight: z.number().int().nonnegative(),
  operations: z.array(OperationSchema).default([]),
  customCSS: z.string().default(''),
  customJS: z.string().default(''),
  /** Teste de URL dividida: redireciona o visitante desta variação. */
  redirect: z.object({ url: z.string().url(), preserveQuery: z.boolean().default(true) }).optional(),
  /** Server-side / feature flag: valores entregues pelo SDK para esta variação. */
  variables: z.record(z.string(), z.unknown()).optional(),
  /** MVT: opção escolhida em cada seção (sectionId → optionId) que gerou esta combinação. */
  combination: z.record(z.string(), z.string()).optional(),
});

/** MVT: seção da página com opções alternativas; a opção 0 é o original (sem alterações). */
export const MvtSectionSchema = z.object({
  id: z.string(),
  name: NameSchema,
  options: z
    .array(
      z.object({
        id: z.string(),
        name: NameSchema,
        operations: z.array(OperationSchema).default([]),
        customCSS: z.string().default(''),
      }),
    )
    .min(2),
});
export type MvtSection = z.infer<typeof MvtSectionSchema>;

/**
 * Tipo de campanha. `ab` e `split` (redirect) são testes; `mvt` gera variações por combinação de seções;
 * `personalization` aplica uma experiência a uma audiência com grupo de controle (holdout); `rollout`
 * libera uma mudança para uma fração do tráfego sem medir contra controle; `server` só existe para o SDK.
 */
export const CampaignTypeSchema = z.enum(['ab', 'split', 'mvt', 'personalization', 'rollout', 'server']);
export type CampaignType = z.infer<typeof CampaignTypeSchema>;
export type Variation = z.infer<typeof VariationSchema>;

/**
 * Página de um teste multipágina (funil): `url` é a página aberta no editor e `match` a regra que a reconhece
 * no site. As operações de cada variação dizem a página em que valem (`Operation.page`).
 */
export const FunnelPageSchema = z.object({
  id: z.string(),
  name: NameSchema,
  url: z.string().url(),
  match: UrlRuleSchema,
});
export type FunnelPage = z.infer<typeof FunnelPageSchema>;

export const AntiFlickerSchema = z.object({
  mode: z.enum(['element', 'page']).default('element'),
  timeoutMs: z.number().int().positive().default(1500),
});
export type AntiFlicker = z.infer<typeof AntiFlickerSchema>;

export const ExperimentStatusSchema = z.enum(['draft', 'running', 'paused', 'archived']);

export const ExperimentSchema = z
  .object({
    id: z.string(),
    key: KeySchema,
    name: NameSchema,
    /** Hipótese do teste ("se mudarmos X, então Y, porque Z"); só para a equipe, não vai para o site. */
    hypothesis: z.string().trim().max(2000).optional(),
    status: ExperimentStatusSchema.default('draft'),
    /** Percentual (0–100) de visitantes elegíveis que entram no experimento. */
    traffic: z.number().min(0).max(100).default(100),
    segmentation: SegmentationSchema.prefault({}),
    /** A primeira variação é o controle. */
    variations: z.array(VariationSchema).min(1),
    goals: z.array(GoalSchema).default([]),
    antiFlicker: AntiFlickerSchema.prefault({}),
    type: CampaignTypeSchema.default('ab'),
    /** MVT: seções e opções; as variações são as combinações (ver `mvtVariations`). */
    sections: z.array(MvtSectionSchema).optional(),
    /** `bandit`: os pesos são recalculados periodicamente pela API (Thompson sampling). */
    /** `autopilot` = bandit + corta perdedoras e, com vencedora declarada, manda todo o tráfego para ela. */
    allocation: z.enum(['manual', 'bandit', 'autopilot']).default('manual'),
    /** Audiências salvas que o visitante precisa satisfazer (todas), além da segmentação. */
    audiences: z.array(z.string()).default([]),
    /**
     * Teste multipágina (funil): presente = as URLs do teste são as das páginas (no lugar das inclusões da
     * segmentação) e cada operação vale só na página dela. CSS/JS da variação valem em todas.
     */
    pages: z.array(FunnelPageSchema).max(20).optional(),
    /**
     * Estatística do relatório (17.5), tudo opcional; ausente = bayesiano clássico. `sequential`: vencedora só
     * com p sempre válido (mSPRT) < 5%, pode olhar a qualquer momento. `cuped`: redução de variância com a
     * atividade do visitante antes da exposição. `guardrails`: ids de metas de guarda (alerta se piorarem).
     */
    stats: z
      .object({
        sequential: z.boolean().optional(),
        cuped: z.boolean().optional(),
        guardrails: z.array(z.string()).max(20).optional(),
      })
      .optional(),
    /**
     * Grupo mutuamente exclusivo: só na config publicada (a API preenche ao compilar, nunca é gravado). O
     * visitante entra se a fatia `bucketOf(visitante, id) % 100` estiver em `slots`.
     */
    group: z.object({ id: z.string(), slots: z.array(z.number().int().min(0).max(99)) }).optional(),
  })
  .superRefine((exp, ctx) => {
    const keys = exp.variations.map((v) => v.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', path: ['variations'], message: 'chaves de variação repetidas' });
    if (exp.variations.reduce((s, v) => s + v.weight, 0) <= 0)
      ctx.addIssue({ code: 'custom', path: ['variations'], message: 'soma dos pesos precisa ser > 0' });
    const pages = exp.pages?.map((p) => p.id) ?? [];
    if (new Set(pages).size !== pages.length)
      ctx.addIssue({ code: 'custom', path: ['pages'], message: 'páginas repetidas' });
  });
export type Experiment = z.infer<typeof ExperimentSchema>;

/**
 * Campos do experimento guardados juntos na coluna JSON `options` (tipo, MVT, alocação, audiências) e da
 * variação na coluna `extra` — evita uma coluna nova por recurso nos dois bancos.
 */
export const EXPERIMENT_OPTION_KEYS = [
  'type',
  'sections',
  'allocation',
  'audiences',
  'pages',
  'stats',
  'hypothesis',
] as const;
export const VARIATION_EXTRA_KEYS = ['variables', 'combination'] as const;
export function pickKeys<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** Página do funil em que a operação vale (sem `page` = 1ª página); undefined fora de teste multipágina. */
export const pageOfOperation = (exp: Pick<Experiment, 'pages'>, op: { page?: string }) =>
  exp.pages?.length ? (op.page ?? exp.pages[0]!.id) : undefined;

/**
 * Prepara o teste para o site (ao publicar): com páginas, as inclusões de URL viram as regras das páginas
 * (exclusões da segmentação continuam) e toda operação leva a página explícita, então o snippet só compara
 * `op.page` com a página atual. Sem páginas, `page` é removida (vale onde a segmentação deixar).
 */
export function compileFunnel(exp: Experiment): Experiment {
  const pages = exp.pages?.length ? exp.pages : undefined;
  return {
    ...exp,
    pages,
    segmentation: pages
      ? {
          ...exp.segmentation,
          urls: [
            ...pages.map((p) => ({ ...p.match, exclude: false })),
            ...exp.segmentation.urls.filter((r) => r.exclude),
          ],
        }
      : exp.segmentation,
    variations: exp.variations.map((v) => ({
      ...v,
      operations: v.operations.map(({ page: _page, ...op }) =>
        pages ? { ...op, page: pageOfOperation(exp, { page: _page }) } : op,
      ),
    })),
  };
}
