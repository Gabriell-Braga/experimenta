import {
  RECO_STRATEGIES,
  recommend,
  type RecoModel,
  type RecoProduct,
  type RecoStrategy,
  type TrackingEvent,
} from '@abtest/shared';
import type { Context } from 'hono';
import type { CdnStore } from './cdn';
import type { Repo } from './repo';

const DAY = 86_400_000;
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

/** Associação por pares a partir de grupos (visitantes ou compras): para cada item, os parceiros mais frequentes. */
function pairs(groups: Iterable<Set<string>>, max = 12): Record<string, string[]> {
  const co = new Map<string, Map<string, number>>();
  for (const g of groups) {
    const ids = [...g];
    if (ids.length < 2 || ids.length > 50) continue; // grupos enormes são ruído (robôs, testes)
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const m = co.get(a) ?? new Map<string, number>();
        m.set(b, (m.get(b) ?? 0) + 1);
        co.set(a, m);
      }
  }
  return Object.fromEntries([...co].map(([id, m]) => [id, top(m).slice(0, max)]));
}

/**
 * Modelo de recomendação a partir dos eventos `product_view` e `purchase` (abq.push(['product'|'purchase', …])):
 * catálogo (último dado visto de cada produto), co-visualização por visitante, comprados juntos, em alta
 * (7 dias), mais vendidos e ranking por categoria (vistas + 3 × compras).
 */
export function buildRecoModel(events: TrackingEvent[], now = Date.now()): RecoModel {
  const catalog: Record<string, RecoProduct> = {};
  const viewsBy = new Map<string, Set<string>>();
  const boughtBy = new Map<string, Set<string>>();
  const purchases: Set<string>[] = [];
  const views7 = new Map<string, number>();
  const sold = new Map<string, number>();
  const score = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.type !== 'event' || e.qa || !e.props) continue;
    if (e.name === 'product_view' && e.props.id !== undefined) {
      const id = String(e.props.id);
      const p = e.props;
      catalog[id] = {
        name: String(p.name ?? catalog[id]?.name ?? id),
        ...(typeof p.price === 'number'
          ? { price: p.price }
          : catalog[id]?.price !== undefined
            ? { price: catalog[id]!.price }
            : {}),
        ...(p.url ? { url: String(p.url) } : catalog[id]?.url ? { url: catalog[id]!.url } : {}),
        ...(p.image ? { image: String(p.image) } : catalog[id]?.image ? { image: catalog[id]!.image } : {}),
        ...(p.category
          ? { category: String(p.category) }
          : catalog[id]?.category
            ? { category: catalog[id]!.category }
            : {}),
      };
      const v = viewsBy.get(e.visitorId) ?? new Set<string>();
      v.add(id);
      viewsBy.set(e.visitorId, v);
      if (now - e.ts < 7 * DAY) views7.set(id, (views7.get(id) ?? 0) + 1);
      score.set(id, (score.get(id) ?? 0) + 1);
    } else if (e.name === 'purchase' && typeof e.props.ids === 'string') {
      const ids = new Set(e.props.ids.split(',').filter(Boolean));
      purchases.push(ids);
      const b = boughtBy.get(e.visitorId) ?? new Set<string>();
      for (const id of ids) {
        b.add(id);
        sold.set(id, (sold.get(id) ?? 0) + 1);
        score.set(id, (score.get(id) ?? 0) + 3);
      }
      boughtBy.set(e.visitorId, b);
    }
  }
  const byCategory: Record<string, string[]> = {};
  for (const id of top(score)) {
    const c = catalog[id]?.category;
    if (c) (byCategory[c] ??= []).push(id);
  }
  return {
    builtAt: new Date(now).toISOString(),
    catalog,
    coview: pairs(viewsBy.values()),
    copurchase: pairs([...purchases, ...boughtBy.values()]),
    trending: top(views7).filter((id) => catalog[id]),
    bestsellers: top(sold).filter((id) => catalog[id]),
    byCategory,
  };
}

export const recoFile = (accountId: string) => `${accountId}.reco.json`;

/** Recalcula e grava o modelo da conta na CDN (últimos 60 dias). */
export async function rebuildReco(repo: Repo, cdn: CdnStore, accountId: string, now = Date.now()) {
  const events = await repo.listEvents(accountId, {
    types: ['event'],
    from: new Date(now - 60 * DAY),
    to: new Date(now),
  });
  const model = buildRecoModel(events, now);
  await cdn.put(recoFile(accountId), JSON.stringify(model));
  return model;
}

/**
 * API pública de recomendações (backend, app, e-mail): `GET /reco/{conta}/{estratégia}?product=&viewed=a,b&limit=`.
 * Lê o modelo pré-calculado da CDN (nada de consulta pesada por requisição).
 */
export function serveReco(cdn: CdnStore) {
  return async (c: Context) => {
    const account = c.req.param('account') ?? '';
    const strategy = c.req.param('strategy') as RecoStrategy;
    if (!/^[\w-]+$/.test(account) || !RECO_STRATEGIES.includes(strategy))
      return c.json({ error: 'parâmetros inválidos' }, 400);
    const raw = await cdn.get(recoFile(account));
    if (!raw) return c.json({ error: 'sem modelo de recomendação para esta conta' }, 404);
    const model = JSON.parse(raw) as RecoModel;
    const ids = recommend(model, strategy, {
      product: c.req.query('product') || undefined,
      viewed: (c.req.query('viewed') ?? '').split(',').filter(Boolean),
      limit: Math.min(24, Math.max(1, Number(c.req.query('limit') ?? 4) || 4)),
    });
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      strategy,
      builtAt: model.builtAt,
      items: ids.map((id) => ({ id, ...model.catalog[id] })),
    });
  };
}
