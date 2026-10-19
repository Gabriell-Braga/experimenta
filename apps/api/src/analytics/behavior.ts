import type { TrackingEvent } from '@abtest/shared';

export interface BehaviorFilter {
  device?: string;
  experimentId?: string;
  variationId?: string;
}

/** Evento de comportamento (mapa de calor) passa nos filtros de dispositivo e variação ativa? */
export function matchesBehavior(e: TrackingEvent, f: BehaviorFilter): boolean {
  if (!('variations' in e)) return false;
  if (f.device && e.device !== f.device) return false;
  if (f.experimentId) {
    const v = e.variations[f.experimentId];
    if (!v || (f.variationId && v !== f.variationId)) return false;
  }
  return true;
}

/**
 * Movimento do mouse (até `maxMoves` pontos mais recentes) e cliques de frustração por elemento
 * (rage/dead com até 100 pontos relativos), para o overlay do mapa de calor.
 */
export function behavior(events: TrackingEvent[], f: BehaviorFilter, maxMoves = 5000) {
  const moves: [number, number][] = [];
  const bySel = new Map<
    string,
    { selector: string; rage: number; dead: number; points: [number, number][] }
  >();
  // Do mais recente para o mais antigo: o teto de pontos fica com os dados novos.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (!matchesBehavior(e, f)) continue;
    if (e.type === 'move') {
      for (const p of e.points) if (moves.length < maxMoves) moves.push(p);
    } else if (e.type === 'frustration') {
      let x = bySel.get(e.selector);
      if (!x) bySel.set(e.selector, (x = { selector: e.selector, rage: 0, dead: 0, points: [] }));
      x[e.kind]++;
      if (x.points.length < 100) x.points.push([e.rx, e.ry]);
    }
  }
  const frustration = [...bySel.values()].sort((a, b) => b.rage + b.dead - (a.rage + a.dead));
  return { moves, frustration };
}
