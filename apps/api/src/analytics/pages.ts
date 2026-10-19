import type { TrackingEvent } from '@abtest/shared';
import { normalizePage } from '../repo';

/**
 * Páginas do site com dados de comportamento no período: páginas vistas, visitantes, cliques, frustração
 * e profundidade média de scroll. Lista do módulo Mapas de calor.
 */
export function pagesReport(events: TrackingEvent[], device?: string) {
  const pages = new Map<
    string,
    {
      page: string;
      href: string;
      title: string;
      pageviews: number;
      visitors: Set<string>;
      clicks: number;
      rage: number;
      dead: number;
      depthSum: number;
      depthN: number;
    }
  >();
  for (const e of events) {
    if (e.qa || ('device' in e && device && e.device !== device)) continue;
    const page = normalizePage(e.url);
    let p = pages.get(page);
    if (!p)
      pages.set(
        page,
        (p = {
          page,
          href: e.url.split(/[?#]/)[0]!,
          title: '',
          pageviews: 0,
          visitors: new Set(),
          clicks: 0,
          rage: 0,
          dead: 0,
          depthSum: 0,
          depthN: 0,
        }),
      );
    if (e.type === 'pageview') {
      p.pageviews++;
      p.visitors.add(e.visitorId);
      if (e.title) p.title = e.title;
      p.href = e.url.split(/[?#]/)[0]!; // URL real (com a barra final que o servidor espera)
    } else if (e.type === 'click') p.clicks++;
    else if (e.type === 'frustration') p[e.kind]++;
    else if (e.type === 'scroll') {
      p.depthSum += e.depth;
      p.depthN++;
    }
  }
  return [...pages.values()]
    .map(({ visitors, depthSum, depthN, ...p }) => ({
      ...p,
      visitors: visitors.size,
      avgScroll: depthN ? Math.round(depthSum / depthN) : null,
    }))
    .sort((a, b) => b.pageviews - a.pageviews || b.clicks - a.clicks);
}
