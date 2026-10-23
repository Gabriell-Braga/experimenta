/** Acima disso (8 semanas) o teste dificilmente conclui: melhor encerrar ou redesenhar. */
export const MAX_USEFUL_DAYS = 56;

/** Classifica a duração restante estimada: desconhecida (null/NaN/negativa), longa demais (> 8 semanas) ou ok. */
export function remainingDuration(
  days: number | null,
): { kind: 'ok'; days: number } | { kind: 'too-long' } | { kind: 'unknown' } {
  if (days === null || Number.isNaN(days) || days < 0) return { kind: 'unknown' };
  if (days > MAX_USEFUL_DAYS) return { kind: 'too-long' };
  return { kind: 'ok', days: Math.ceil(days) };
}
