/**
 * Roteamento mínimo por query string: `?exp=<id>` abre o editor visual; `?view=<tela>&...` as demais telas
 * (sem parâmetro = lista de testes). Query string em vez de caminho: o Worker de arquivos estáticos não
 * precisa de fallback de rota.
 */
export const expParam = () => new URLSearchParams(location.search).get('exp');

export interface Route {
  view: string;
  params: URLSearchParams;
}

export const currentRoute = (): Route => {
  const params = new URLSearchParams(location.search);
  return { view: params.get('view') ?? 'tests', params };
};

function push(search: string) {
  history.pushState(null, '', search || location.pathname);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function go(exp: string | null) {
  push(exp ? `?exp=${encodeURIComponent(exp)}` : '');
}

export function navigate(view: string, params: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams({ view });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  push(`?${q}`);
}

/** Atualiza parâmetros da tela atual sem novo item no histórico (filtros). */
export function setParams(params: Record<string, string | undefined>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  history.replaceState(null, '', `?${q}`);
}
