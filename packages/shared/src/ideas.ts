/** Colunas do backlog de hipóteses (fase 18.3), na ordem do quadro. */
export const IDEA_STAGES = ['idea', 'prioritized', 'testing', 'done'] as const;
export type IdeaStage = (typeof IDEA_STAGES)[number];

/** Pontuação ICE: impacto, confiança e facilidade de 1 a 10. */
export interface Ice {
  impact: number;
  confidence: number;
  ease: number;
}

/** Score ICE = média simples das três notas (1–10), com uma casa decimal. */
export const iceScore = (i: Ice) => Math.round(((i.impact + i.confidence + i.ease) / 3) * 10) / 10;
