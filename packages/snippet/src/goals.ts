import type { Goal } from '@abtest/shared';
import type { Runtime } from './runtime';
import { matchUrl } from './segment';

/**
 * Liga as metas de TODOS os experimentos em que o visitante está (não só os ativos na página atual):
 * a conversão costuma acontecer em outra página (ex.: /obrigado).
 * Retorna `track(evento, valor)` para metas customizadas.
 */
export function installGoals(win: Window, rt: Runtime): (event: string, value?: number) => void {
  const doc = win.document;

  const convert = (match: (g: Goal) => boolean, value?: number) => {
    for (const { experiment, variation } of rt.assigned()) {
      for (const g of experiment.goals) {
        if (match(g))
          rt.emit(experiment, variation, {
            type: 'conversion',
            goalId: g.id,
            goalKey: g.key,
            ...(value !== undefined ? { value } : {}),
          });
      }
    }
  };

  const closest = (target: EventTarget | null, selector: string) => {
    try {
      return target instanceof Element && !!target.closest(selector);
    } catch {
      return false;
    }
  };

  doc.addEventListener(
    'click',
    (e) => convert((g) => g.type === 'click' && closest(e.target, g.selector)),
    true,
  );
  doc.addEventListener(
    'submit',
    (e) => convert((g) => g.type === 'formSubmit' && closest(e.target, g.selector)),
    true,
  );

  const pageview = (url: string) => convert((g) => g.type === 'pageview' && matchUrl(g.url, url));
  pageview(win.location.href);
  rt.onNavigate.push(pageview);

  return (event, value) => convert((g) => g.type === 'custom' && g.event === event, value);
}
