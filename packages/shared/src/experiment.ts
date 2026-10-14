import { z } from 'zod';
import { OperationSchema } from './operations';

/** Chave legível usada em URLs (ex.: ?ab_force=experimento:variacao). */
export const KeySchema = z.string().regex(/^[a-z0-9][a-z0-9-_]*$/, 'use minúsculas, números, - e _');

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
  name: z.string().min(1),
  /** Peso relativo (inteiro). A distribuição é weight / soma dos pesos. */
  weight: z.number().int().nonnegative(),
  operations: z.array(OperationSchema).default([]),
  customCSS: z.string().default(''),
  customJS: z.string().default(''),
  /** Teste de URL dividida: redireciona o visitante desta variação. */
  redirect: z.object({ url: z.string().url(), preserveQuery: z.boolean().default(true) }).optional(),
});
export type Variation = z.infer<typeof VariationSchema>;

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
    name: z.string().min(1),
    status: ExperimentStatusSchema.default('draft'),
    /** Percentual (0–100) de visitantes elegíveis que entram no experimento. */
    traffic: z.number().min(0).max(100).default(100),
    segmentation: SegmentationSchema.default({}),
    /** A primeira variação é o controle. */
    variations: z.array(VariationSchema).min(1),
    goals: z.array(GoalSchema).default([]),
    antiFlicker: AntiFlickerSchema.default({}),
  })
  .superRefine((exp, ctx) => {
    const keys = exp.variations.map((v) => v.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', path: ['variations'], message: 'chaves de variação repetidas' });
    if (exp.variations.reduce((s, v) => s + v.weight, 0) <= 0)
      ctx.addIssue({ code: 'custom', path: ['variations'], message: 'soma dos pesos precisa ser > 0' });
  });
export type Experiment = z.infer<typeof ExperimentSchema>;
