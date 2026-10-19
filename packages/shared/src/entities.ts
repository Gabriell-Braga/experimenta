import { z } from 'zod';
import { UrlRuleSchema } from './experiment';

/**
 * Entidades de configuração dos módulos, guardadas na tabela genérica `entities` (D-049).
 * Cada tipo tem seu schema; a API valida `data` por `kind` antes de gravar.
 */

/** Passo de funil: página visitada (regra de URL) ou evento customizado. */
export const FunnelStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), name: z.string().min(1).max(80), url: UrlRuleSchema }),
  z.object({ type: z.literal('event'), name: z.string().min(1).max(80), event: z.string().min(1).max(100) }),
]);
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

export const FunnelSchema = z.object({
  steps: z.array(FunnelStepSchema).min(2).max(12),
  /** Prazo para completar o funil a partir do 1º passo. */
  windowDays: z.number().int().min(1).max(90).default(7),
});
export type Funnel = z.infer<typeof FunnelSchema>;

export const ENTITY_SCHEMAS = {
  funnel: FunnelSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
export type EntityKind = keyof typeof ENTITY_SCHEMAS;
