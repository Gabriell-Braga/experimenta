// Config do SDK server-side (`/cdn/<conta>.sdk.json`): flags e campanhas server-side, sem dependências.
import type { Experiment } from './experiment';
import type { Flag } from './entities';

export interface SdkConfig {
  accountId: string;
  version: number;
  publishedAt: string;
  trackingUrl?: string;
  flags: Flag[];
  experiments: Pick<Experiment, 'id' | 'key' | 'traffic' | 'variations' | 'goals'>[];
}

type Attrs = Record<string, string | number | boolean | undefined>;

/** Regra de atributo de flag. */
export function flagRuleMatches(r: Flag['rules'][number], attrs: Attrs): boolean {
  const v = attrs[r.attribute];
  if (v === undefined) return r.op === 'neq';
  const s = String(v);
  switch (r.op) {
    case 'eq':
      return s === r.value;
    case 'neq':
      return s !== r.value;
    case 'in':
      return r.value
        .split(',')
        .map((x) => x.trim())
        .includes(s);
    case 'contains':
      return s.includes(r.value);
    case 'gte':
      return Number(v) >= Number(r.value);
    case 'lte':
      return Number(v) <= Number(r.value);
  }
}
