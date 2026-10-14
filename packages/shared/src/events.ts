import { z } from 'zod';

/** Eventos emitidos pelo snippet para o analytics. Documentação: docs/EVENTOS.md. */
const base = {
  /** Identificador único do evento (deduplicação no analytics). */
  eventId: z.string(),
  ts: z.number().int(),
  accountId: z.string(),
  visitorId: z.string(),
  url: z.string(),
};

const inExperiment = {
  ...base,
  experimentId: z.string(),
  experimentKey: z.string(),
  variationId: z.string(),
  variationKey: z.string(),
};

export const TrackingEventSchema = z.discriminatedUnion('type', [
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
