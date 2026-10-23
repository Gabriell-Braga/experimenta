// Banner de cookies do demo (D-099): o workspace espera consentimento e este banner avisa o snippet.
// Só aparece se a config publicada pede consentimento e o visitante ainda não decidiu (cookie _abt_c do snippet).
(function () {
  var cfg = window.__ABT_CONFIG__;
  if (!cfg || !cfg.consent || /(^|; )_abt_c=/.test(document.cookie)) return;
  var bar = document.createElement('div');
  var decide = function (ok) {
    window.abq = window.abq || [];
    window.abq.push(['consent', ok]);
    bar.remove();
  };
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Cookies');
  bar.setAttribute('data-testid', 'cookie-banner');
  bar.style.cssText =
    'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483646;max-width:560px;margin:0 auto;' +
    'background:#14161a;color:#f4f2ec;border-radius:12px;padding:14px 16px;font:14px/1.45 system-ui,sans-serif;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;flex-wrap:wrap;gap:10px;align-items:center';
  var text = document.createElement('span');
  text.style.flex = '1 1 260px';
  text.textContent =
    'Usamos cookies para medir o uso do site e testar melhorias. Você aceita? Dá para mudar de ideia depois.';
  var btn = function (label, ok, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;' +
      (primary
        ? 'background:#f4f2ec;color:#14161a'
        : 'background:transparent;color:#f4f2ec;box-shadow:inset 0 0 0 1px #f4f2ec88');
    b.onclick = function () {
      decide(ok);
    };
    return b;
  };
  bar.append(text, btn('Recusar', false), btn('Aceitar', true, true));
  var show = function () {
    document.body.appendChild(bar);
  };
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
