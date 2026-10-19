// Recomendações de produto: modelo pré-calculado pela API (CDN `<conta>.reco.json`) e estratégias puras,
// usadas pelo widget no site (engage.js) e pela API pública.

export interface RecoProduct {
  name: string;
  price?: number;
  url?: string;
  image?: string;
  category?: string;
}

export interface RecoModel {
  builtAt: string;
  catalog: Record<string, RecoProduct>;
  /** Quem viu este também viu (ordenado pela força da associação). */
  coview: Record<string, string[]>;
  /** Comprados juntos (mesma compra ou mesmo visitante). */
  copurchase: Record<string, string[]>;
  /** Mais vistos nos últimos 7 dias. */
  trending: string[];
  /** Mais comprados no período. */
  bestsellers: string[];
  /** Produtos por categoria, do mais popular ao menos. */
  byCategory: Record<string, string[]>;
}

export const RECO_STRATEGIES = ['coview', 'copurchase', 'upsell', 'nbo', 'trending', 'bestsellers'] as const;
export type RecoStrategy = (typeof RECO_STRATEGIES)[number];

/**
 * Lista de ids recomendados. `product` = produto de referência (página atual / último visto);
 * `viewed` = produtos já vistos pelo visitante (excluídos da próxima melhor oferta).
 * Sem dado suficiente, completa com os mais vistos (nunca devolve o próprio produto).
 */
export function recommend(
  m: RecoModel,
  strategy: RecoStrategy,
  o: { product?: string; viewed?: string[]; limit?: number } = {},
): string[] {
  const limit = o.limit ?? 4;
  const p = o.product;
  const cur = p ? m.catalog[p] : undefined;
  let list: string[] = [];
  if (strategy === 'coview') list = (p && m.coview[p]) || [];
  else if (strategy === 'copurchase') list = (p && m.copurchase[p]) || [];
  else if (strategy === 'upsell')
    list =
      cur?.category && cur.price !== undefined
        ? (m.byCategory[cur.category] ?? []).filter((id) => (m.catalog[id]?.price ?? 0) > cur.price! * 1.05)
        : [];
  else if (strategy === 'nbo') {
    // Categoria com mais visualizações do visitante → mais populares dela que ele ainda não viu.
    const counts = new Map<string, number>();
    for (const id of o.viewed ?? []) {
      const c = m.catalog[id]?.category;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const seen = new Set(o.viewed);
    list = top ? (m.byCategory[top] ?? []).filter((id) => !seen.has(id)) : [];
  } else if (strategy === 'bestsellers') list = m.bestsellers;
  else list = m.trending;
  const out: string[] = [];
  for (const id of [...list, ...m.trending, ...m.bestsellers])
    if (id !== p && !out.includes(id) && m.catalog[id] && out.length < limit) out.push(id);
  return out;
}
