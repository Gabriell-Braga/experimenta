import type { Trigger } from '@abtest/shared';

/**
 * Arma um gatilho e chama `fire` uma única vez quando ele acontece. Devolve a função que desarma
 * (troca de rota na SPA, campanha já exibida).
 */
export function arm(win: Window, t: Trigger, fire: () => void): () => void {
  const doc = win.document;
  let done = false;
  const offs: (() => void)[] = [];
  const once = () => {
    if (done) return;
    done = true;
    offs.forEach((f) => f());
    fire();
  };
  const on = <K extends string>(
    target: EventTarget,
    ev: K,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    offs.push(() => target.removeEventListener(ev, fn, opts));
  };
  switch (t.type) {
    case 'load':
      win.setTimeout(once, 0);
      break;
    case 'delay': {
      const id = win.setTimeout(once, t.seconds * 1000);
      offs.push(() => win.clearTimeout(id));
      break;
    }
    case 'scroll': {
      const check = () => {
        const h = doc.documentElement.scrollHeight - win.innerHeight;
        if (h <= 0 || (win.scrollY / h) * 100 >= t.percent) once();
      };
      on(win, 'scroll', check, { passive: true });
      break;
    }
    case 'exit':
      // Desktop: mouse saindo pela borda de cima. Celular: subida rápida de scroll perto do topo.
      on(doc, 'mouseout', (e) => {
        const m = e as MouseEvent;
        if (!m.relatedTarget && m.clientY <= 0) once();
      });
      {
        let lastY = win.scrollY;
        on(
          win,
          'scroll',
          () => {
            const y = win.scrollY;
            if (lastY - y > 120 && y < 400) once();
            lastY = y;
          },
          { passive: true },
        );
      }
      break;
    case 'inactive': {
      let id = 0;
      const reset = () => {
        win.clearTimeout(id);
        id = win.setTimeout(once, t.seconds * 1000);
      };
      for (const ev of ['mousemove', 'keydown', 'scroll', 'touchstart'])
        on(win, ev, reset, { passive: true });
      offs.push(() => win.clearTimeout(id));
      reset();
      break;
    }
    case 'click':
      on(
        doc,
        'click',
        (e) => {
          try {
            if (e.target instanceof Element && e.target.closest(t.selector)) once();
          } catch {
            /* seletor inválido */
          }
        },
        { capture: true },
      );
      break;
  }
  return () => {
    done = true;
    offs.forEach((f) => f());
  };
}
