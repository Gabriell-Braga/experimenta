/** Domínio (host) de uma URL; '' se não der para ler. Telas do app (`app://<appId>/...`) dão o appId. */
export function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Domínios distintos das linhas, do que mais aparece ao que menos aparece. */
export function domainsOf<T>(rows: T[], url: (r: T) => string): string[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const d = domainOf(url(r));
    if (d) n.set(d, (n.get(d) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

/** Tira as linhas dos domínios escondidos (domínios antigos, staging...). */
export const withoutDomains = <T>(rows: T[], url: (r: T) => string, hidden: string[]) =>
  hidden.length ? rows.filter((r) => !hidden.includes(domainOf(url(r)))) : rows;

/** Gravações curtas demais para assistir (0:00, rejeição imediata) ficam escondidas por padrão. */
export const SHORT_RECORDING_SECONDS = 10;

const KEY = 'abt.hiddenDomains';

/** Domínios escondidos nas listas de insights; por navegador (localStorage), pode falhar em modo privado. */
export function loadHiddenDomains(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}
export function saveHiddenDomains(hidden: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(hidden));
  } catch {
    /* sem storage: vale só nesta tela */
  }
}
