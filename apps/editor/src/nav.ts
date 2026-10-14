/** Roteamento mínimo: ?exp=<id> abre o editor; sem parâmetro, lista de experimentos. */
export const expParam = () => new URLSearchParams(location.search).get('exp');

export function go(exp: string | null) {
  history.pushState(null, '', exp ? `?exp=${encodeURIComponent(exp)}` : location.pathname);
  dispatchEvent(new PopStateEvent('popstate'));
}
