import type { Device, Segmentation, UrlRule } from '@abtest/shared';

export interface SegmentContext {
  url: string;
  device: Device;
  isNew: boolean;
}

/** Compara sem barra final para "exata" não depender de /pagina vs /pagina/. */
const trimSlash = (u: string) => u.replace(/\/(?=$|[?#])/, '');

export function matchUrl(rule: UrlRule, url: string): boolean {
  if (rule.match === 'exact') return trimSlash(url.split('#')[0]!) === trimSlash(rule.value.split('#')[0]!);
  if (rule.match === 'contains') return url.includes(rule.value);
  try {
    return new RegExp(rule.value).test(url);
  } catch {
    return false;
  }
}

export function matchSegmentation(seg: Segmentation, ctx: SegmentContext): boolean {
  const urls = seg.urls ?? [];
  const includes = urls.filter((r) => !r.exclude);
  if (urls.some((r) => r.exclude && matchUrl(r, ctx.url))) return false;
  if (includes.length && !includes.some((r) => matchUrl(r, ctx.url))) return false;

  if (seg.devices?.length && !seg.devices.includes(ctx.device)) return false;

  if (seg.query?.length) {
    let params: URLSearchParams;
    try {
      params = new URL(ctx.url).searchParams;
    } catch {
      return false;
    }
    for (const q of seg.query) {
      if (!params.has(q.key)) return false;
      if (q.value !== undefined && params.get(q.key) !== q.value) return false;
    }
  }

  if (seg.visitor === 'new' && !ctx.isNew) return false;
  if (seg.visitor === 'returning' && ctx.isNew) return false;
  return true;
}
