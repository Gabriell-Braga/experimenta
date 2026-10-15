/**
 * Chama `onChange` quando a URL muda por pushState/replaceState/popstate/hashchange (navegação de SPA).
 * Onde existe a Navigation API (Chromium), também ouve `currententrychange`: pega rotas trocadas por
 * routers que guardaram o `pushState` original antes do snippet (ex.: snippet carregado via tag manager).
 * Retorna a função que desfaz os patches.
 */
export function watchLocation(win: Window, onChange: (url: string) => void): () => void {
  const h = win.history;
  let last = win.location.href;
  const check = () => {
    const now = win.location.href;
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  h.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    origPush.apply(this, args);
    check();
  };
  h.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    origReplace.apply(this, args);
    check();
  };
  const nav = (win as Window & { navigation?: EventTarget }).navigation;
  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  nav?.addEventListener('currententrychange', check);
  return () => {
    h.pushState = origPush;
    h.replaceState = origReplace;
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
    nav?.removeEventListener('currententrychange', check);
  };
}
