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

export const NEXT_ACTIONS = [
  'implement',
  'keep-running',
  'stop-iterate',
  'investigate-srm',
  'test-idea',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
export const CONFIDENCES = ['alta', 'média', 'baixa'] as const;

/**
 * Explicação do relatório de um experimento (fase 18.5). Ação, variação, dias e confiança vêm das regras sobre
 * os números do relatório (a IA não decide); o modelo só escreve os textos e a ideia (D-085).
 */
export const ReportSummarySchema = z.object({
  /** O resultado em linguagem simples. */
  summary: line,
  /** O que significa para o negócio. */
  business: line,
  confidence: z.enum(CONFIDENCES),
  /** Ressalvas (SRM, amostra pequena, meta de guarda, novidade...). */
  caveats: lines,
  next: z.object({
    action: z.enum(NEXT_ACTIONS),
    text: line,
    /** Variação a implementar. */
    variation: z.string().max(200).optional(),
    /** Continuar rodando: dias estimados (sem estimativa = ausente). */
    days: z.number().int().nonnegative().optional(),
    /** Ideia para o backlog (parar e iterar / testar ideia). */
    idea: z.object({ title: line, hypothesis: line, change: line }).optional(),
  }),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

const fin = z.number().finite();
const p01 = z.number().min(0).max(1);
const VERDICTS = ['winner', 'loser', 'leading', 'inconclusive', 'baseline'] as const;
const ArmNumbers = z.object({
  variationId: z.string().max(100),
  visitors: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  revenue: fin,
  rpv: fin,
  rate: p01,
  rateLow: p01,
  rateHigh: p01,
  lift: fin.nullable(),
  liftLow: fin.nullable(),
  liftHigh: fin.nullable(),
  probBeatControl: p01.nullable(),
  probBest: p01,
  pValue: p01.nullable(),
  verdict: z.enum(VERDICTS),
  sequential: z.object({ pValue: p01, liftLow: fin.nullable(), liftHigh: fin.nullable() }).nullish(),
  guardrailViolated: z.boolean().optional(),
});

/**
 * Números do relatório que a tela já tem (`GET /experiments/:id/report`), mandados de volta para a explicação
 * sem recalcular a estatística na API. Dado do cliente: a API confere a coerência e só usa para explicar.
 * Campos a mais (seções, CUPED, nomes) são descartados.
 */
export const ReportNumbersSchema = z.object({
  visitors: z.number().int().nonnegative(),
  variations: z
    .array(z.object({ id: z.string().max(100), visitors: z.number().int().nonnegative() }))
    .max(30),
  goals: z
    .array(
      z.object({
        goalId: z.string().max(100),
        hasRevenue: z.boolean(),
        guardrail: z.boolean().optional(),
        arms: z.array(ArmNumbers).max(30),
        revenueArms: z
          .array(
            z.object({
              variationId: z.string().max(100),
              lift: fin.nullable(),
              probBeatControl: p01.nullable(),
              verdict: z.enum(VERDICTS),
            }),
          )
          .max(30)
          .nullable(),
      }),
    )
    .max(30),
  /** Só para os dias com dados (primeiro dia com visitante até o fim do período). */
  series: z
    .array(z.object({ points: z.array(z.object({ visitors: z.number().nonnegative() })).max(400) }))
    .max(30)
    .optional(),
  srm: z.object({ pValue: p01.nullable(), mismatch: z.boolean() }),
  stats: z.object({ sequential: z.boolean(), cuped: z.boolean() }).optional(),
  guardrails: z
    .array(
      z.object({
        goalId: z.string().max(100),
        variationId: z.string().max(100),
        metric: z.enum(['rate', 'revenue']),
        lift: fin.nullable(),
      }),
    )
    .max(100)
    .optional(),
  estimate: z.object({
    neededPerVariation: fin.nonnegative().nullable(),
    daysRemaining: z.number().int().nonnegative().nullable(),
    mde: fin,
  }),
});
export type ReportNumbers = z.infer<typeof ReportNumbersSchema>;

export const AI_SUMMARY_KINDS = ['recording', 'heatmap', 'survey', 'report'] as const;
export type AiSummaryKind = (typeof AI_SUMMARY_KINDS)[number];

/** Rótulos dos elementos clicados e elementos clicáveis sem clique, lidos pelo agent na página real. */
export const HeatmapContextSchema = z.object({
  labels: z.record(z.string().max(500), z.string().max(120)),
  ignored: z.array(z.string().max(120)).max(30),
});
export type HeatmapContext = z.infer<typeof HeatmapContextSchema>;
