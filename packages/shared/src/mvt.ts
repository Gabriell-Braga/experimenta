import type { MvtSection, Variation } from './experiment';

/** Chave estável de uma combinação (ids das opções em ordem de seção). */
export const comboKey = (c: Record<string, string>, sections: MvtSection[]) =>
  sections.map((s) => c[s.id] ?? '').join('|');

/**
 * Variações de um teste multivariado = produto cartesiano das opções de cada seção (fatorial completo).
 * A combinação só com originais (opção 0 de todas) é o controle e vem primeiro. Variações existentes com a
 * mesma combinação mantêm id, chave e peso (o snippet usa o id para atribuição persistida).
 */
export function mvtVariations(sections: MvtSection[], existing: Variation[]): Variation[] {
  let combos: Record<string, string>[] = [{}];
  for (const s of sections) combos = combos.flatMap((c) => s.options.map((o) => ({ ...c, [s.id]: o.id })));
  const prev = new Map(
    existing.filter((v) => v.combination).map((v) => [comboKey(v.combination!, sections), v]),
  );
  const used = new Set<string>();
  return combos.map((combination, i) => {
    const picked = sections.map((s) => s.options.find((o) => o.id === combination[s.id])!);
    const old = prev.get(comboKey(combination, sections));
    let key = old?.key ?? (i === 0 ? 'controle' : `combinacao-${i}`);
    while (used.has(key)) key = `${key}-${i}`;
    used.add(key);
    return {
      id: old?.id ?? `${sections.map((s) => combination[s.id]).join('_')}`.slice(0, 120),
      key,
      name: i === 0 ? 'Controle (original)' : picked.map((o) => o.name).join(' × '),
      weight: old?.weight ?? 1,
      operations: picked.flatMap((o) => o.operations),
      customCSS: picked
        .map((o) => o.customCSS)
        .filter(Boolean)
        .join('\n'),
      customJS: '',
      combination,
    };
  });
}
