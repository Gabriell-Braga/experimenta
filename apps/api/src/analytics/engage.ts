import type { TrackingEvent } from '@abtest/shared';

/** Desempenho de pop-ups/pesquisas: exibições, visitantes únicos, cliques no CTA, fechamentos e respostas. */
export function engageReport(events: TrackingEvent[]) {
  const by = new Map<
    string,
    {
      campaignId: string;
      kind: string;
      views: number;
      viewers: Set<string>;
      clicks: number;
      closes: number;
      submits: number;
    }
  >();
  for (const e of events) {
    if (e.type !== 'engage' || e.qa) continue;
    let x = by.get(e.campaignId);
    if (!x)
      by.set(
        e.campaignId,
        (x = {
          campaignId: e.campaignId,
          kind: e.kind,
          views: 0,
          viewers: new Set(),
          clicks: 0,
          closes: 0,
          submits: 0,
        }),
      );
    if (e.action === 'view') {
      x.views++;
      x.viewers.add(e.visitorId);
    } else if (e.action === 'click') x.clicks++;
    else if (e.action === 'close') x.closes++;
    else x.submits++;
  }
  return [...by.values()].map(({ viewers, ...x }) => ({
    ...x,
    viewers: viewers.size,
    ctr: x.views ? x.clicks / x.views : 0,
    responseRate: x.views ? x.submits / x.views : 0,
  }));
}
