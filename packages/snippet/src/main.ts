// Entrada do bundle publicado (dist/abt.js). Precisa rodar de forma síncrona no <head>.
import type { Props, PublishedConfig, TrackingEvent } from '@abtest/shared';
import { readConfig } from './config';
import { consentGate, type App } from './consent';
import { installData } from './data';
import { editToken } from './editor';
import { local } from './env';
import { installGoals } from './goals';
import { watchDataLayer } from './gtm';
import { engageBoot, loadBundle } from './engage';
import { insightsBoot, sampled } from './insights';
import { integrationsAdapter } from './integrations';
import { readForce, sessionParam } from './qa';
import { start } from './runtime';
import { createTracker, type Adapter } from './tracker';

/** Comandos aceitos por window.abq.push([...]). Referência: docs/EVENTOS.md. */
type Command =
  | ['track', string, number?, Props?]
  | ['event', string, Props?]
  | ['identify', string | null, Props?]
  | ['set', Props]
  /** E-commerce (recomendações): produto visto, adicionado ao carrinho e compra. */
  | ['product', Props & { id: string | number }]
  | ['cart', string | number]
  | ['purchase', (string | number)[], number?]
  | ['adapter', Adapter]
  /** LGPD/GDPR: aceita (true) ou recusa (false, apaga cookies e desliga o snippet). */
  | ['consent', boolean];

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
/** Bundles sob demanda ficam na mesma pasta do script da conta. */
const sibling = (file: string) => new URL(file, script?.src || location.href).href;
const config = readConfig();
const token = config && editToken(window);
if (config && token) {
  // Modo edição: a página fica original (sem experimentos); o agent aplica a variação em edição.
  // A marca avisa a extensão (fallback) de que o site já tem o snippet.
  document.documentElement.dataset.abtEditor = 'snippet';
  loadBundle(window, sibling('edit.js'), '__ABT_EDIT__', { config, token, agent: sibling('agent.js') });
} else if (config) {
  const pending = Array.isArray(window.abq) ? window.abq : [];
  const run = consentGate(window, config.consent, () => boot(config));
  // Processa o que o site enfileirou antes do snippet e troca a fila por um executor imediato.
  window.abq = { push: run as (c: Command) => void };
  pending.forEach(run);
}

/** Liga testes, coleta e bundles sob demanda. Só roda com consentimento (ou sem exigência na conta). */
function boot(config: PublishedConfig): App | undefined {
  // Link de pré-visualização (`?abt_preview=<token>`, guardado na sessão): o preview.js busca o rascunho na API e
  // aplica só ele, sem os experimentos publicados nem coleta.
  const preview = sessionParam(window, 'abt_preview');
  if (preview) return void loadBundle(window, sibling('preview.js'), '__ABT_PREVIEW__', preview);
  const forced = readForce(window);
  const tracker = createTracker(window, config.trackingUrl);
  // Desligado (recusa): nada mais sai, nem do que já estiver carregado (insights.js, engage.js).
  let live = true;
  const send = (e: TrackingEvent) => live && tracker.send(e);
  const sink = { send, flush: tracker.flush };
  if (config.integrations) tracker.addAdapter(integrationsAdapter(window, config.integrations));
  const rt = start(window, config, { forced, sink: send });
  if (!rt) return;
  const goal = installGoals(window, rt);
  const storage = local(window);
  const data = installData(window, rt, send, storage);
  const track = (name: string, value?: number, props?: Props) => {
    goal(name, value);
    data.track(name, value, props);
  };
  if (config.dataLayer)
    watchDataLayer(
      window,
      config.dataLayer,
      (config.integrations || []).flatMap((t) => (t[0] == 'dataLayer' ? [t[1], t[2]] : [])),
      (name, props) => track(name, typeof props.value == 'number' ? props.value : undefined, props),
      (id) => data.identify(id),
      () => rt.profile.u,
    );
  // Insights (mapa de calor, frustração, formulários, gravação): só amostrados e nunca em QA.
  const hm = config.heatmap;
  const insights = insightsBoot(window, rt, sink, config);
  if (hm?.sampleRate && !forced && sampled(rt.visitor.id, hm.sampleRate))
    loadBundle(window, sibling('insights.js'), '__ABT_INSIGHTS__', insights);
  // Engajamento: só quando há pop-up/pesquisa publicado.
  if ((config.popups?.length || config.surveys?.length || config.recos?.length) && !forced)
    loadBundle(window, sibling('engage.js'), '__ABT_ENGAGE__', engageBoot(window, rt, sink, sibling('./')));
  window.abt = {
    visitorId: rt.visitor.id,
    sessionId: rt.visitor.sessionId,
    assignments: () => Object.fromEntries(rt.assigned().map((a) => [a.experiment.key, a.variation.key])),
    flush: tracker.flush,
  };
  // Modo QA: painel com o log por página (regra de URL, variação, metas) no qa.js.
  if (forced) loadBundle(window, sibling('qa.js'), '__ABT_QA__', rt);
  return {
    run(c) {
      const k = c as Command;
      if (k[0] === 'track') track(k[1], k[2], k[3]);
      else if (k[0] === 'event') track(k[1], typeof k[2]?.value === 'number' ? k[2].value : undefined, k[2]);
      else if (k[0] === 'identify') data.identify(k[1], k[2]);
      else if (k[0] === 'set') data.identify(null, k[1]);
      else if (k[0] === 'product') {
        data.viewed(String(k[1].id));
        track('product_view', undefined, { ...k[1], id: String(k[1].id) });
      } else if (k[0] === 'cart') track('add_to_cart', undefined, { id: String(k[1]) });
      else if (k[0] === 'purchase') track('purchase', k[2], { ids: k[1].map(String).join(',') });
      else if (k[0] === 'adapter') tracker.addAdapter(k[1]);
    },
    stop() {
      tracker.flush();
      live = false;
      insights.stopped = true;
      rt.stop();
      delete window.abt;
    },
  };
}
