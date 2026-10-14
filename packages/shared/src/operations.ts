import { z } from 'zod';

/** Impressão digital do elemento: usada para "curar" o seletor quando ele quebra. */
export const FingerprintSchema = z.object({
  tag: z.string().min(1),
  /** Texto visível resumido (normalizado, até 80 caracteres). */
  text: z.string().max(80),
  /** Atributos-chave (id, name, href, src, alt, role, type, data-*, aria-label...). */
  attrs: z.record(z.string()),
  /** Posição aproximada relativa ao documento, em px. */
  pos: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export const TargetSchema = z.object({
  selector: z.string().min(1),
  alternates: z.array(z.string().min(1)).default([]),
  fingerprint: FingerprintSchema.optional(),
});
export type Target = z.infer<typeof TargetSchema>;

export const PositionSchema = z.enum(['before', 'after', 'prepend', 'append']);
export type Position = z.infer<typeof PositionSchema>;

const base = {
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  target: TargetSchema,
};

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('setText'), value: z.string() }),
  z.object({ ...base, type: z.literal('setHTML'), value: z.string() }),
  /** Propriedades CSS em kebab-case → valor ("" remove a propriedade). */
  z.object({ ...base, type: z.literal('setStyle'), value: z.record(z.string()) }),
  /** value null remove o atributo. */
  z.object({
    ...base,
    type: z.literal('setAttribute'),
    value: z.object({ name: z.string().min(1), value: z.string().nullable() }),
  }),
  z.object({ ...base, type: z.literal('addClass'), value: z.string().min(1) }),
  z.object({ ...base, type: z.literal('removeClass'), value: z.string().min(1) }),
  z.object({ ...base, type: z.literal('hide') }),
  z.object({ ...base, type: z.literal('remove') }),
  /** Move o alvo para `position` relativo a `anchor`. */
  z.object({
    ...base,
    type: z.literal('move'),
    value: z.object({ position: PositionSchema, anchor: TargetSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('insertHTML'),
    value: z.object({ position: PositionSchema, html: z.string() }),
  }),
  z.object({
    ...base,
    type: z.literal('replaceImage'),
    value: z.object({ src: z.string().min(1), srcset: z.string().optional(), alt: z.string().optional() }),
  }),
]);
export type Operation = z.infer<typeof OperationSchema>;
export type OperationType = Operation['type'];
export const OPERATION_TYPES = OperationSchema.options.map((o) => o.shape.type.value) as OperationType[];
