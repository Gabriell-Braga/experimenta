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

const Text = z.object({
  op: z.enum(['eq', 'neq', 'contains', 'regex', 'exists']),
  value: z.string().default(''),
});
const Num = z.object({ op: z.enum(['gte', 'lte', 'eq']), value: z.number() });

/**
 * Regra de audiência, avaliada no navegador pelo snippet (sem ida ao servidor). Comportamento vem do perfil
 * local do visitante (páginas vistas, sessões, eventos, páginas visitadas, origem da 1ª visita, atributos).
 */
export const AudienceRuleSchema = z.discriminatedUnion('type', [
  /** Site de origem desta visita (`document.referrer`); vazio = acesso direto. */
  z.object({ type: z.literal('referrer'), ...Text.shape }),
  /** Parâmetro UTM da 1ª visita (first-touch) ou da URL atual. */
  z.object({
    type: z.literal('utm'),
    param: z.enum(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']),
    ...Text.shape,
  }),
  /** Atributo do visitante (`abq.push(['identify'|'set', …])`). */
  z.object({
    type: z.literal('attribute'),
    key: z.string().min(1),
    op: z.enum(['eq', 'neq', 'contains', 'exists', 'gte', 'lte']),
    value: z.string().default(''),
  }),
  z.object({ type: z.literal('pageviews'), ...Num.shape }),
  z.object({ type: z.literal('sessions'), ...Num.shape }),
  /** Quantas vezes fez o evento customizado. */
  z.object({ type: z.literal('event'), name: z.string().min(1), ...Num.shape }),
  /** Já visitou uma página (caminho contém). */
  z.object({ type: z.literal('visited'), value: z.string().min(1), negate: z.boolean().default(false) }),
  z.object({ type: z.literal('cookie'), name: z.string().min(1), ...Text.shape }),
  /** Variável global da página (ex.: `dataLayer.0.plano`, `usuario.tipo`). */
  z.object({ type: z.literal('js'), path: z.string().min(1), ...Text.shape }),
  /** Idioma do navegador (prefixo, ex.: `pt`, `en-US`). */
  z.object({ type: z.literal('language'), value: z.string().min(1) }),
  /** Horário local do visitante: horas [from, to) e dias da semana (0 = domingo). */
  z.object({
    type: z.literal('time'),
    from: z.number().int().min(0).max(23).default(0),
    to: z.number().int().min(1).max(24).default(24),
    days: z.array(z.number().int().min(0).max(6)).default([]),
  }),
  z.object({ type: z.literal('device'), value: z.enum(['desktop', 'tablet', 'mobile']) }),
  z.object({ type: z.literal('visitor'), value: z.enum(['new', 'returning']) }),
  /** Score preditivo de propensão a converter (0..1, fase 15.3). */
  z.object({ type: z.literal('score'), ...Num.shape }),
]);
export type AudienceRule = z.infer<typeof AudienceRuleSchema>;

export const AudienceSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(AudienceRuleSchema).min(1).max(30),
});
export type Audience = z.infer<typeof AudienceSchema>;

export const ENTITY_SCHEMAS = {
  funnel: FunnelSchema,
  audience: AudienceSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
export type EntityKind = keyof typeof ENTITY_SCHEMAS;
