// Lê o dataLayer do site (GTM/gtag): eventos viram eventos do Experimenta e o `user_id` que o site já usa vira
// identify (tarefas 21.3/21.4). Entra no bundle do site: manter enxuto.
import type { Props } from '@abtest/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type O = Record<string, any>;

/**
 * `skip`: nomes que nós mesmos empurramos (integração GTM), para não voltarem como evento.
 * `known()`: usuário já identificado (evita um identify por página).
 */
export function watchDataLayer(
  win: Window,
  opts: { events?: boolean; userId?: boolean },
  skip: string[],
  track: (name: string, props: Props) => void,
  identify: (id: string) => void,
  known: () => string | undefined,
): void {
  const w = win as unknown as O;
  const dl: O[] = (w.dataLayer = w.dataLayer || []);
  const seen = (o: O) => {
    if (!o || typeof o != 'object') return;
    // gtag('config' | 'set', …, { user_id }) chega como `arguments`: o objeto é o último argumento.
    const last: O = typeof o.length == 'number' ? o[o.length - 1] : o;
    const id = last?.user_id ?? last?.userId;
    if (opts.userId && id != null && id !== '' && String(id) !== known()) identify(String(id));
    const name = o.event;
    if (opts.events && typeof name == 'string' && name.indexOf('gtm.') && skip.indexOf(name) < 0) {
      const p: Props = {};
      for (const k in o) {
        const v = o[k];
        if (k != 'event' && k.indexOf('gtm') && /^(st|bo|nu)/.test(typeof v))
          p[k] = typeof v == 'string' ? v.slice(0, 500) : v;
      }
      track(name.slice(0, 100), p);
    }
  };
  dl.forEach(seen);
  const push = dl.push;
  dl.push = function (...a: O[]) {
    a.forEach(seen);
    return push.apply(this, a);
  };
}
