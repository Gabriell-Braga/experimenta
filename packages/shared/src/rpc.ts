import { z } from 'zod';
import { OperationSchema, TargetSchema } from './operations';

/**
 * Protocolo app (editor) ↔ agent (dentro do iframe do site) sobre postMessage.
 * Envelope: { abt: 1, kind: 'req' | 'res' | 'evt', ... }. Ambos os lados podem chamar e emitir.
 */

// ---------- Tipos de domínio trocados ----------

export const ElementInfoSchema = z.object({
  target: TargetSchema,
  fragility: z.enum(['low', 'medium', 'high']),
  tag: z.string(),
  text: z.string(),
  /** Só texto (sem filhos elemento): permite editar texto direto no painel. */
  textOnly: z.boolean(),
  attributes: z.record(z.string()),
  /** Estilos computados relevantes para o painel de propriedades (kebab-case). */
  styles: z.record(z.string()),
  isImage: z.boolean(),
  /** Ancestrais do mais próximo ao mais distante (para o breadcrumb). */
  breadcrumb: z.array(z.object({ label: z.string(), selector: z.string() })),
});
export type ElementInfo = z.infer<typeof ElementInfoSchema>;

export const VariationPayloadSchema = z.object({
  operations: z.array(OperationSchema),
  customCSS: z.string().default(''),
  customJS: z.string().default(''),
  /** Executar customJS no preview (o editor pede confirmação antes). */
  runJS: z.boolean().default(false),
});

export const ApplyResultSchema = z.object({
  applied: z.array(z.object({ id: z.string(), via: z.enum(['primary', 'alternate', 'fingerprint']) })),
  failed: z.array(z.string()),
});
export type ApplyResult = z.infer<typeof ApplyResultSchema>;

/** Rascunho de operação criado pelo agent (o app define id e ordem). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type OperationDraft = DistributiveOmit<z.infer<typeof OperationSchema>, 'id' | 'order'>;
// zod não deriva o tipo do omit sobre a união; o cast preserva a validação e dá o tipo certo.
export const OperationDraftSchema = z.discriminatedUnion(
  'type',
  (OperationSchema.options as readonly z.AnyZodObject[]).map((o) =>
    o.omit({ id: true, order: true }),
  ) as unknown as [z.AnyZodObject, z.AnyZodObject, ...z.AnyZodObject[]],
) as unknown as z.ZodType<OperationDraft, z.ZodTypeDef, unknown>;

/** Agregado do mapa de calor (mesmo formato de GET /heatmap). */
export const HeatmapDataSchema = z.object({
  clicks: z.object({
    total: z.number(),
    elements: z.array(
      z.object({
        selector: z.string(),
        count: z.number(),
        points: z.array(z.tuple([z.number(), z.number()])),
      }),
    ),
  }),
  scroll: z.object({
    pageviews: z.number(),
    reached: z.array(z.object({ depth: z.number(), pct: z.number() })),
  }),
  /** Movimento do mouse: [x 0..1 da largura, y px do documento]. */
  moves: z.array(z.tuple([z.number(), z.number()])).default([]),
  /** Cliques de frustração por elemento. */
  frustration: z
    .array(
      z.object({
        selector: z.string(),
        rage: z.number(),
        dead: z.number(),
        points: z.array(z.tuple([z.number(), z.number()])),
      }),
    )
    .default([]),
  /** O que desenhar: calor (cliques), mapa de cliques (contagens), scroll, movimento ou frustração. */
  mode: z.enum(['heat', 'click', 'scroll', 'move', 'frustration']).default('heat'),
});
export type HeatmapMode = HeatmapData['mode'];
export type HeatmapData = z.infer<typeof HeatmapDataSchema>;

// ---------- Métodos e eventos ----------

const method = <P extends z.ZodTypeAny, R extends z.ZodTypeAny>(params: P, result: R) => ({ params, result });

/** Métodos que o AGENT expõe (o app chama). */
export const agentMethods = {
  ping: method(z.object({}), z.object({ version: z.string(), url: z.string(), title: z.string() })),
  setMode: method(z.object({ mode: z.enum(['edit', 'browse']) }), z.object({})),
  applyVariation: method(VariationPayloadSchema, ApplyResultSchema),
  select: method(z.object({ selector: z.string().nullable() }), ElementInfoSchema.nullable()),
  highlight: method(z.object({ selector: z.string().nullable() }), z.object({ found: z.boolean() })),
  /** Desenha o mapa de calor sobre a página real; devolve quantos seletores foram achados nesta página. */
  showHeatmap: method(HeatmapDataSchema, z.object({ resolved: z.number(), missing: z.number() })),
  hideHeatmap: method(z.object({}), z.object({})),
};

/** Métodos que o APP expõe (o agent chama). */
export const appMethods = {
  /** Pede ao usuário um valor (HTML a inserir, URL de imagem...). null = cancelado. */
  prompt: method(
    z.object({ kind: z.enum(['html', 'image']), title: z.string(), initial: z.string().default('') }),
    z.string().nullable(),
  ),
};

/** Eventos que o AGENT emite. */
export const agentEvents = {
  ready: z.object({ version: z.string(), url: z.string(), title: z.string() }),
  selected: ElementInfoSchema.nullable(),
  operation: z.object({ draft: OperationDraftSchema }),
  navigated: z.object({ url: z.string() }),
};

export type Methods = Record<string, { params: z.ZodTypeAny; result: z.ZodTypeAny }>;
export type Events = Record<string, z.ZodTypeAny>;
export type AgentMethods = typeof agentMethods;
export type AppMethods = typeof appMethods;
export type AgentEvents = typeof agentEvents;
export type AppEvents = Record<never, z.ZodTypeAny>;

// ---------- Envelope ----------

export const EnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    abt: z.literal(1),
    kind: z.literal('req'),
    id: z.string(),
    method: z.string(),
    params: z.unknown(),
  }),
  z.object({
    abt: z.literal(1),
    kind: z.literal('res'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ abt: z.literal(1), kind: z.literal('evt'), event: z.string(), payload: z.unknown() }),
]);
export type Envelope = z.infer<typeof EnvelopeSchema>;
