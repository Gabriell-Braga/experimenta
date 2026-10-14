import type { Experiment, Variation } from '@abtest/shared';

/** MurmurHash3 x86 32 bits sobre os bytes UTF-8 da string. */
export function murmurhash3(key: string, seed = 0): number {
  const bytes = new TextEncoder().encode(key);
  const len = bytes.length;
  const nblocks = len >> 2;
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  for (let i = 0; i < nblocks; i++) {
    const o = i * 4;
    let k = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  const tail = nblocks * 4;
  switch (len & 3) {
    case 3:
      k ^= bytes[tail + 2]! << 16;
    // falls through
    case 2:
      k ^= bytes[tail + 1]! << 8;
    // falls through
    case 1:
      k ^= bytes[tail]!;
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const BUCKETS = 10000;

export function bucketOf(visitorId: string, experimentId: string): number {
  return murmurhash3(visitorId + experimentId) % BUCKETS;
}

/**
 * Atribuição determinística. bucket < traffic% entra no experimento; dentro dessa faixa,
 * a posição relativa escolhe a variação proporcionalmente aos pesos. null = fora do tráfego.
 */
export function chooseVariation(
  visitorId: string,
  exp: Pick<Experiment, 'id' | 'traffic' | 'variations'>,
): Variation | null {
  const b = bucketOf(visitorId, exp.id);
  const included = Math.round(exp.traffic * (BUCKETS / 100));
  if (b >= included) return null;
  const total = exp.variations.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return null;
  let point = (b / included) * total;
  for (const v of exp.variations) {
    if (point < v.weight) return v;
    point -= v.weight;
  }
  return exp.variations[exp.variations.length - 1]!;
}

const ASSIGN_KEY = '_abt_a';

/** Atribuições persistidas: experimentId → variationId. Sobrevivem a mudança de pesos/tráfego. */
export function loadAssignments(storage: Storage | undefined): Record<string, string> {
  try {
    return JSON.parse(storage?.getItem(ASSIGN_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveAssignments(storage: Storage | undefined, a: Record<string, string>): void {
  try {
    storage?.setItem(ASSIGN_KEY, JSON.stringify(a));
  } catch {
    /* storage cheio ou bloqueado: atribuição continua determinística pelo hash */
  }
}

/** Variação persistida (se ainda existir) ou nova escolha determinística, que é então persistida. */
export function assign(
  visitorId: string,
  exp: Pick<Experiment, 'id' | 'traffic' | 'variations'>,
  stored: Record<string, string>,
): Variation | null {
  const prev = stored[exp.id] && exp.variations.find((v) => v.id === stored[exp.id]);
  if (prev) return prev;
  const v = chooseVariation(visitorId, exp);
  if (v) stored[exp.id] = v.id;
  return v;
}
