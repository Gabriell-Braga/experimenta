/**
 * Parâmetro de URL guardado na sessão para sobreviver à navegação (`?param=off` limpa). Usado pelo modo QA e
 * pelo link de pré-visualização.
 */
export function sessionParam(win: Window, param: string, key = '_' + param): string | null {
  let raw = new URLSearchParams(win.location.search).get(param);
  try {
    if (raw === 'off' || raw === '') win.sessionStorage.removeItem(key);
    else if (raw) win.sessionStorage.setItem(key, raw);
    else raw = win.sessionStorage.getItem(key);
  } catch {
    /* sem sessionStorage: vale só para esta página */
  }
  return raw && raw !== 'off' ? raw : null;
}

/**
 * Modo QA: `?ab_force=experimento:variacao[,exp2:var2]` força variações (ignora segmentação e tráfego).
 * Fica salvo na sessão para sobreviver à navegação; `?ab_force=off` limpa.
 */
export function readForce(win: Window): Record<string, string> | undefined {
  const raw = sessionParam(win, 'ab_force');
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [exp, variation] = pair.split(':');
    if (exp && variation) out[exp.trim()] = variation.trim();
  }
  return Object.keys(out).length ? out : undefined;
}
