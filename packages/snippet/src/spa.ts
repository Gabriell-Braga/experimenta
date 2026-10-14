/**
 * Chama `onChange` quando a URL muda por pushState/replaceState/popstate (navegação de SPA).
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
  win.addEventListener('popstate', check);
  return () => {
    h.pushState = origPush;
    h.replaceState = origReplace;
    win.removeEventListener('popstate', check);
  };
}
