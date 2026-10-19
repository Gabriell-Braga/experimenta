// Entrada do bundle publicado (dist/abt.js). Precisa rodar de forma síncrona no <head>.
import type { Props } from '@abtest/shared';
import { readConfig } from './config';
import { installData } from './data';
import { bootEditor, editToken } from './editor';
import { installGoals } from './goals';
import { detectDevice } from './env';
import { installHeatmap } from './heatmap';
import { loadInsights } from './insights';
import { readForce, showBadge } from './qa';
import { start } from './runtime';
import { createTracker, type Adapter } from './tracker';

/** Comandos aceitos por window.abq.push([...]). Referência: docs/EVENTOS.md. */
type Command =
  | ['track', string, number?, Props?]
  | ['event', string, Props?]
  | ['identify', string | null, Props?]
  | ['set', Props]
  | ['adapter', Adapter];

declare global {
  interface Window {
    abq?: Command[] | { push(c: Command): void };
    abt?: {
      visitorId: string;
      sessionId: string;
      assignments(): Record<string, string>;
      flush(): void;
    };
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const config = readConfig();
const token = config && editToken(window);
if (config && token) {
  // Modo edição: a página fica original (sem experimentos); o agent aplica a variação em edição.
  // A marca avisa a extensão (fallback) de que o site já tem o snippet.
  document.documentElement.dataset.abtEditor = 'snippet';
  bootEditor(window, config, token, new URL('agent.js', script?.src || location.href).href);
} else if (config) {
  const forced = readForce(window);
  const tracker = createTracker(window, config.trackingUrl);
  const rt = start(window, config, { forced, sink: tracker.send });
  if (rt) {
    const goal = installGoals(window, rt);
    const storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return undefined;
      }
    })();
    const data = installData(window, rt, tracker.send, storage);
    const track = (name: string, value?: number, props?: Props) => {
      goal(name, value);
      data.track(name, value, props);
    };
    // Mapa de calor: só visitantes amostrados e nunca em modo QA (não polui os dados).
    const hm = config.heatmap;
    if (hm?.sampleRate && !forced && installHeatmap(window, rt, tracker, hm.sampleRate) && config.apiUrl)
      if (hm.recordings || hm.forms)
        loadInsights(window, new URL('insights.js', script?.src || location.href).href, {
          apiUrl: config.apiUrl,
          accountId: config.accountId,
          visitorId: rt.visitor.id,
          sessionId: rt.visitor.sessionId,
          device: detectDevice(navigator.userAgent, innerWidth),
          record: !!hm.recordings,
          forms: !!hm.forms,
          send: tracker.send,
          base: rt.base,
          variations: () =>
            Object.fromEntries([...rt.active.values()].map((a) => [a.experiment.id, a.variation.id])),
          onNavigate: rt.onNavigate,
        });
    const run = (c: Command) => {
      if (c[0] === 'track') track(c[1], c[2], c[3]);
      else if (c[0] === 'event') track(c[1], typeof c[2]?.value === 'number' ? c[2].value : undefined, c[2]);
      else if (c[0] === 'identify') data.identify(c[1], c[2]);
      else if (c[0] === 'set') data.identify(null, c[1]);
      else if (c[0] === 'adapter') tracker.addAdapter(c[1]);
    };
    // Processa o que o site enfileirou antes do snippet e troca a fila por um executor imediato.
    const pending = Array.isArray(window.abq) ? window.abq : [];
    window.abq = { push: run };
    pending.forEach(run);
    window.abt = {
      visitorId: rt.visitor.id,
      sessionId: rt.visitor.sessionId,
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
