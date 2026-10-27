import { z } from 'zod';
import { PositionSchema, TargetSchema, type Target } from './operations';
import type { OperationDraft } from './rpc';

/**
 * Variação por texto (IA): o agent resume o DOM visível, o app manda pedido + resumo à API, o modelo devolve
 * alterações que citam elementos pelo `ref` do resumo (nunca seletores) e o app troca o `ref` pelo alvo
 * gerado pelo agent. Só operações declarativas: nada de HTML nem JS por esse caminho (D-081).
 */

/** Tamanho máximo do pedido do usuário. */
export const AI_PROMPT_MAX = 1000;
/** Elementos no resumo da página (os primeiros visíveis, na ordem do documento). */
export const PAGE_ELEMENTS_MAX = 200;
/** Tamanho máximo dos elementos do resumo serializados (o agent para antes; a API recusa acima). */
export const PAGE_SUMMARY_CHARS = 60_000;
/** Alterações aceitas numa resposta. */
export const AI_CHANGES_MAX = 30;

const Ref = z.string().regex(/^e\d{1,4}$/);
const smallRecord = (max: number, valueMax: number) =>
  z
    .record(z.string().max(40), z.string().max(valueMax))
    .refine((o) => Object.keys(o).length <= max, `no máximo ${max} chaves`);

export const PageElementSchema = z.object({
  ref: Ref,
  tag: z.string().max(20),
  /** Texto visível próprio do elemento (normalizado e cortado). */
  text: z.string().max(120),
  attrs: smallRecord(10, 200),
  /** Estilos computados principais (cor, fundo, fonte). */
  styles: smallRecord(6, 80),
});
export type PageElement = z.infer<typeof PageElementSchema>;

/** O que vai para a API e para o modelo: sem seletores. */
export const PageSummarySchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(200),
  elements: z.array(PageElementSchema).max(PAGE_ELEMENTS_MAX),
});
export type PageSummary = z.infer<typeof PageSummarySchema>;

/** Resumo como o agent devolve: mais o alvo (seletor, alternativos, impressão digital) de cada `ref`. */
export const PageSnapshotSchema = PageSummarySchema.extend({ targets: z.record(z.string(), TargetSchema) });
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Alterações que a IA pode propor (sem setHTML/insertHTML/classes/remove e nunca customJS). */
export const AiChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setText'), ref: Ref, value: z.string() }),
  z.object({ type: z.literal('setStyle'), ref: Ref, value: z.record(z.string(), z.string()) }),
  z.object({
    type: z.literal('setAttribute'),
    ref: Ref,
    value: z.object({ name: z.string(), value: z.string() }),
  }),
  z.object({ type: z.literal('hide'), ref: Ref }),
  z.object({ type: z.literal('replaceImage'), ref: Ref, value: z.object({ src: z.string() }) }),
  z.object({
    type: z.literal('move'),
    ref: Ref,
    value: z.object({ position: PositionSchema, anchor: Ref }),
  }),
]);
export type AiChange = z.infer<typeof AiChangeSchema>;
export const AI_CHANGE_TYPES = AiChangeSchema.options.map((o) => o.shape.type.value);

/** Troca os `ref` pelos alvos do agent. `null` se algum `ref` não existe (página mudou). */
export function changeToDraft(c: AiChange, targets: Record<string, Target>): OperationDraft | null {
  const target = targets[c.ref];
  if (!target) return null;
  if (c.type === 'move') {
    const anchor = targets[c.value.anchor];
    return anchor ? { type: 'move', target, value: { position: c.value.position, anchor } } : null;
  }
  const { ref: _ref, ...rest } = c;
  return { ...rest, target } as OperationDraft;
}
