import { z } from 'zod';

/**
 * Resumo por IA (fase 18.4) de uma gravação, do mapa de calor de uma página ou das respostas abertas de uma
 * pesquisa. A API monta uma entrada compacta e sem dados pessoais, o modelo devolve um destes formatos e a API
 * valida e guarda em cache (D-084).
 */

const line = z.string().max(400);
/** Listas sem teto aqui: a API corta (até 8) antes de validar. */
const lines = z.array(line);

export const RecordingSummarySchema = z.object({
  /** O que o visitante provavelmente queria fazer. */
  goal: line,
  /** Passos que deu, em ordem. */
  steps: lines,
  /** Onde travou ou desistiu ('' = não travou). */
  stuck: line,
  /** Sinais de frustração (cliques de raiva, cliques sem resposta, formulário abandonado...). */
  frustration: lines,
});
export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;

export const HeatmapSummarySchema = z.object({
  /** O que concentra cliques e atenção. */
  attention: lines,
  /** O que é ignorado (sem cliques, abaixo de onde a maioria rola). */
  ignored: lines,
  /** Sugestões de teste. */
  suggestions: lines,
});
export type HeatmapSummary = z.infer<typeof HeatmapSummarySchema>;

export const SENTIMENTS = ['positivo', 'neutro', 'negativo', 'misto'] as const;
export const SentimentSchema = z.enum(SENTIMENTS);

export const SurveySummarySchema = z.object({
  sentiment: SentimentSchema,
  /** Uma ou duas frases sobre o conjunto das respostas. */
  overview: line,
  themes: z.array(
    z.object({
      name: line,
      /** Respostas da amostra que tocam no tema. */
      count: z.number().int().nonnegative(),
      sentiment: SentimentSchema,
      /** Trechos de respostas (já mascarados). */
      examples: lines,
    }),
  ),
});
export type SurveySummary = z.infer<typeof SurveySummarySchema>;

export const AI_SUMMARY_KINDS = ['recording', 'heatmap', 'survey'] as const;
export type AiSummaryKind = (typeof AI_SUMMARY_KINDS)[number];

/** Rótulos dos elementos clicados e elementos clicáveis sem clique, lidos pelo agent na página real. */
export const HeatmapContextSchema = z.object({
  labels: z.record(z.string().max(500), z.string().max(120)),
  ignored: z.array(z.string().max(120)).max(30),
});
export type HeatmapContext = z.infer<typeof HeatmapContextSchema>;
