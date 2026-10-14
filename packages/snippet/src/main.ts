// Entrada do bundle publicado (dist/abt.js). Precisa rodar de forma síncrona no <head>.
import { readConfig } from './config';
import { installGoals } from './goals';
import { readForce, showBadge } from './qa';
import { start } from './runtime';
import { createTracker, type Adapter } from './tracker';

/** Comandos aceitos por window.abq.push([...]). */
type Command = ['track', string, number?] | ['adapter', Adapter];

declare global {
  interface Window {
    abq?: Command[] | { push(c: Command): void };
    abt?: { visitorId: string; assignments(): Record<string, string>; flush(): void };
  }
}

const config = readConfig();
if (config) {
  const forced = readForce(window);
  const tracker = createTracker(window, config.trackingUrl);
  const rt = start(window, config, { forced, sink: tracker.send });
  if (rt) {
    const track = installGoals(window, rt);
    const run = (c: Command) => {
      if (c[0] === 'track') track(c[1], c[2]);
      else if (c[0] === 'adapter') tracker.addAdapter(c[1]);
    };
    // Processa o que o site enfileirou antes do snippet e troca a fila por um executor imediato.
    const pending = Array.isArray(window.abq) ? window.abq : [];
    window.abq = { push: run };
    pending.forEach(run);
    window.abt = {
      visitorId: rt.visitor.id,
      assignments: () => Object.fromEntries(rt.assigned().map((a) => [a.experiment.key, a.variation.key])),
      flush: tracker.flush,
    };
    if (forced)
      showBadge(
        document,
        [...rt.active.values()].map((a) => ({ experiment: a.experiment.name, variation: a.variation.name })),
      );
  }
}
