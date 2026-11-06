/** Trecho sem interação maior que isto é pulado no player de gravações. */
export const INACTIVE_MS = 3000;
/** Ao pular, para um pouco antes da próxima interação para dar contexto. */
const LEAD_MS = 800;

type RrEvent = { timestamp: number; type: number; data?: { source?: number } };

/**
 * Intervalos sem interação do visitante (ms relativos ao início), para o player pular. Interação = carga de página
 * (snapshot completo) ou evento incremental de mouse, clique, rolagem, resize, input ou toque (rrweb source 1–6);
 * mutações do DOM (carrossel, animação) não contam. O rrweb tem `skipInactive`, mas só acelera depois de 10 s
 * parados e só a partir de eventos incrementais, então na prática quase não pula.
 */
export function inactiveGaps(events: RrEvent[], start: number, total: number): [number, number][] {
  const marks = events
    .filter((e) => e.type === 2 || (e.type === 3 && (e.data?.source ?? 0) >= 1 && (e.data?.source ?? 0) <= 6))
    .map((e) => e.timestamp - start)
    .sort((a, b) => a - b);
  const gaps: [number, number][] = [];
  let last = 0;
  for (const m of [...marks, total]) {
    if (m - last > INACTIVE_MS) gaps.push([last, m === total ? total : m - LEAD_MS]);
    last = Math.max(last, m);
  }
  return gaps;
}

/** Para onde saltar se `t` está num trecho inativo (com folga de 1 s); senão `null`. */
export function skipTarget(gaps: [number, number][], t: number): number | null {
  const g = gaps.find(([a, b]) => t >= a && t < b - 1000);
  return g ? g[1] : null;
}
