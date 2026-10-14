import type { Fragility } from './generate';
import { isGeneratedToken } from './stability';

/**
 * Fragilidade de um seletor qualquer (gerado ou digitado), só pelo texto:
 * - high: depende de posição (nth-*) ou de id/classe com cara de gerada (hash, CSS-in-JS);
 * - medium: caminho longo (≥ 3 combinadores) ou só tags;
 * - low: ancorado em id/data-* estável ou classe/atributo estável curto.
 */
export function selectorFragility(selector: string): Fragility {
  if (/:nth-(of-type|child|last-child|last-of-type)\(/.test(selector)) return 'high';
  const tokens = [...selector.matchAll(/[#.]((?:\\.|[\w-])+)/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
  if (tokens.some(isGeneratedToken)) return 'high';
  if (/^\s*(#[\w-]+|\[data-[\w-]+=)/.test(selector) && !/[\s>+~]/.test(selector.replace(/"[^"]*"/g, '')))
    return 'low';
  const combinators = (selector.replace(/"[^"]*"/g, '').match(/\s*[\s>+~]\s*/g) ?? []).length;
  if (combinators >= 3 || !/[#.[]/.test(selector)) return 'medium';
  return combinators === 0 ? 'low' : 'medium';
}
