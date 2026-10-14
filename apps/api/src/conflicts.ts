import type { Experiment, Segmentation } from '@abtest/shared';
import { matchUrl } from '@abtest/snippet/segment';

export interface ExperimentAt {
  experiment: Experiment;
  /** Página de referência do experimento (aberta no editor). */
  editorUrl: string;
}

export interface Conflict {
  experimentId: string;
  name: string;
  status: Experiment['status'];
  /** Seletores DESTE experimento que o outro também altera. */
  selectors: string[];
}

const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, '$1')
    .trim();

/** A segmentação de URL aceita esta URL? (vazia = todas; exclusão vence). */
function urlAccepts(seg: Segmentation, url: string): boolean {
  if (seg.urls.some((r) => r.exclude && matchUrl(r, url))) return false;
  const inc = seg.urls.filter((r) => !r.exclude);
  return !inc.length || inc.some((r) => matchUrl(r, url));
}

/**
 * Podem rodar na mesma página para o mesmo visitante? Aproximação: a página de referência de um
 * casa com a segmentação do outro (em qualquer sentido) e os dispositivos não são disjuntos.
 */
export function canOverlap(a: ExperimentAt, b: ExperimentAt): boolean {
  const da = a.experiment.segmentation.devices;
  const db = b.experiment.segmentation.devices;
  if (da.length && db.length && !da.some((d) => db.includes(d))) return false;
  return (
    urlAccepts(b.experiment.segmentation, a.editorUrl) || urlAccepts(a.experiment.segmentation, b.editorUrl)
  );
}

/** Todos os seletores (principal + alternativos) que um experimento altera, em qualquer variação. */
function targets(e: Experiment): Map<string, string> {
  // normalizado → seletor principal original
  const out = new Map<string, string>();
  for (const v of e.variations)
    for (const op of v.operations)
      for (const s of [op.target.selector, ...op.target.alternates]) out.set(norm(s), op.target.selector);
  return out;
}

/**
 * Outros experimentos (não arquivados) que alteram os mesmos elementos em páginas que podem coincidir.
 * Dois experimentos no mesmo elemento brigam pela mesma mudança e contaminam o resultado um do outro.
 */
export function findConflicts(self: ExperimentAt, others: ExperimentAt[]): Conflict[] {
  const mine = targets(self.experiment);
  const out: Conflict[] = [];
  for (const o of others) {
    if (o.experiment.id === self.experiment.id || o.experiment.status === 'archived' || !canOverlap(self, o))
      continue;
    const shared = new Set<string>();
    for (const k of targets(o.experiment).keys()) {
      const selector = mine.get(k);
      if (selector) shared.add(selector);
    }
    if (shared.size)
      out.push({
        experimentId: o.experiment.id,
        name: o.experiment.name,
        status: o.experiment.status,
        selectors: [...shared],
      });
  }
  return out;
}
