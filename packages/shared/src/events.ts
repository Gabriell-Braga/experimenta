import { z } from 'zod';

/** Eventos emitidos pelo snippet para o analytics. Documentação: docs/EVENTOS.md. */
const base = {
  /** Identificador único do evento (deduplicação no analytics). */
  eventId: z.string(),
  ts: z.number().int(),
  accountId: z.string(),
  visitorId: z.string(),
  url: z.string(),
  /** true quando a variação foi forçada pelo modo QA (?ab_force) — o analytics deve descartar. */
  qa: z.boolean().optional(),
  /** Sessão: renovada após 30 min sem atividade (cookie first-party). Ausente em eventos antigos. */
  sessionId: z.string().optional(),
};

/** Propriedades livres de eventos e atributos de visitante (valores escalares). */
export const PropsSchema = z.record(z.union([z.string().max(500), z.number(), z.boolean()]));
export type Props = z.infer<typeof PropsSchema>;

const inExperiment = {
  ...base,
  experimentId: z.string(),
  experimentKey: z.string(),
  variationId: z.string(),
  variationKey: z.string(),
};

/** Contexto dos eventos de mapa de calor: dispositivo e variações ATIVAS na página (experimentId → variationId). */
const heatmapBase = {
  ...base,
  device: z.enum(['desktop', 'tablet', 'mobile']),
  variations: z.record(z.string()),
};

export const TrackingEventSchema = z.discriminatedUnion('type', [
  /** Página vista (carregamento ou rota de SPA). Base para funis, jornadas, coortes e perfis. */
  z.object({
    ...base,
    type: z.literal('pageview'),
    device: z.enum(['desktop', 'tablet', 'mobile']),
    title: z.string().max(300).optional(),
    referrer: z.string().max(1000).optional(),
    vw: z.number().optional(),
  }),
  /** Evento customizado: `abq.push(['track', nome, valor?, props?])` ou `['event', nome, props?]`. */
  z.object({
    ...base,
    type: z.literal('event'),
    name: z.string().min(1).max(100),
    value: z.number().optional(),
    props: PropsSchema.optional(),
  }),
  /** Identificação: liga o visitante (cookie) a um usuário do site e/ou grava atributos. */
  z.object({
    ...base,
    type: z.literal('identify'),
    userId: z.string().max(200).optional(),
    attrs: PropsSchema.optional(),
  }),
  /** Clique para o mapa de calor: elemento + posição relativa dentro dele (0..1) + coordenadas de página. */
  z.object({
    ...heatmapBase,
    type: z.literal('click'),
    selector: z.string().max(500),
    rx: z.number().min(0).max(1),
    ry: z.number().min(0).max(1),
    px: z.number(),
    py: z.number(),
    vw: z.number(),
    vh: z.number(),
  }),
  /** Profundidade máxima de scroll da página (0..100 % da altura), enviada ao sair/navegar. */
  z.object({
    ...heatmapBase,
    type: z.literal('scroll'),
    depth: z.number().min(0).max(100),
    vh: z.number(),
    ph: z.number(),
  }),
  z.object({ ...inExperiment, type: z.literal('exposure') }),
  z.object({
    ...inExperiment,
    type: z.literal('conversion'),
    goalId: z.string(),
    goalKey: z.string(),
    value: z.number().optional(),
  }),
  z.object({
    ...inExperiment,
    type: z.literal('selector_failed'),
    operationId: z.string(),
    selector: z.string(),
  }),
  z.object({
    ...inExperiment,
    type: z.literal('selector_healed'),
    operationId: z.string(),
    selector: z.string(),
    healedSelector: z.string(),
    via: z.enum(['alternate', 'fingerprint']),
  }),
]);
export type TrackingEvent = z.infer<typeof TrackingEventSchema>;
export type TrackingEventType = TrackingEvent['type'];
export type HeatmapEvent = Extract<TrackingEvent, { type: 'click' | 'scroll' }>;
export type DataEvent = Extract<TrackingEvent, { type: 'pageview' | 'event' | 'identify' }>;
export type ExperimentEvent = Exclude<TrackingEvent, HeatmapEvent | DataEvent>;
