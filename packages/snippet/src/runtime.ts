import type { Experiment, PublishedConfig, TrackingEvent, Variation } from '@abtest/shared';
import { hide } from './antiflicker';
import { assign, loadAssignments, saveAssignments } from './bucket';
import { applyOperations, type ApplyHandle } from './engine/apply';
import { detectDevice, getVisitor, isBot, randomId, type Visitor } from './env';
import { matchSegmentation } from './segment';
import { watchLocation } from './spa';

/** Distribui o Omit sobre a união (Omit direto colapsa a união discriminada). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventPayload = DistributiveOmit<
  TrackingEvent,
  | 'eventId'
  | 'ts'
  | 'accountId'
  | 'visitorId'
  | 'url'
  | 'experimentId'
  | 'experimentKey'
  | 'variationId'
  | 'variationKey'
>;

export interface Active {
  experiment: Experiment;
  variation: Variation;
  handle?: ApplyHandle;
  cleanup: (() => void)[];
}

export interface RuntimeOptions {
  /** Recebe cada evento pronto (tracker). */
  sink?: (e: TrackingEvent) => void;
  /** Variações forçadas por chave: experimentKey → variationKey (modo QA). */
  forced?: Record<string, string>;
}

export interface Runtime {
  visitor: Visitor;
  config: PublishedConfig;
  active: Map<string, Active>;
  /** Reavalia segmentação/atribuição para a URL atual e aplica/remove experimentos. */
  evaluate(): void;
  emit(exp: Experiment, variation: Variation, payload: EventPayload): void;
  /** Experimentos em que o visitante está (persistidos ou forçados), mesmo fora da página atual. */
  assigned(): { experiment: Experiment; variation: Variation }[];
  /** Ouvintes chamados após cada navegação de SPA (já reavaliada). */
  onNavigate: ((url: string) => void)[];
  /** Desfaz tudo: experimentos ativos e patches de history. */
  stop(): void;
}

export function start(win: Window, config: PublishedConfig, opts: RuntimeOptions = {}): Runtime | null {
  const nav = win.navigator;
  if (isBot(nav.userAgent)) return null;
  const doc = win.document;
  const visitor = getVisitor(win);
  const storage = (() => {
    try {
      return win.localStorage;
    } catch {
      return undefined;
    }
  })();
  const stored = loadAssignments(storage);
  const active = new Map<string, Active>();

  const forcedOf = (exp: Experiment) => {
    const key = opts.forced?.[exp.key];
    return key ? exp.variations.find((v) => v.key === key) : undefined;
  };

  const emit: Runtime['emit'] = (exp, variation, payload) =>
    opts.sink?.({
      ...payload,
      eventId: randomId(),
      ts: Date.now(),
      accountId: config.accountId,
      visitorId: visitor.id,
      url: win.location.href,
      experimentId: exp.id,
      experimentKey: exp.key,
      variationId: variation.id,
      variationKey: variation.key,
      ...(forcedOf(exp) ? { qa: true } : {}),
    } as TrackingEvent);

  const deactivate = (id: string) => {
    const a = active.get(id);
    if (!a) return;
    a.handle?.revert();
    a.cleanup.forEach((f) => f());
    active.delete(id);
  };

  const activate = (exp: Experiment, variation: Variation) => {
    const a: Active = { experiment: exp, variation, cleanup: [] };
    active.set(exp.id, a);

    if (variation.redirect) {
      const target = new URL(variation.redirect.url, win.location.href);
      if (target.href.split('?')[0] !== win.location.href.split('?')[0]) {
        hide(doc, [], 'page', exp.antiFlicker.timeoutMs);
        if (variation.redirect.preserveQuery)
          new URLSearchParams(win.location.search).forEach((v, k) => target.searchParams.set(k, v));
        emit(exp, variation, { type: 'exposure' });
        win.location.replace(target.href);
        return;
      }
    }

    if (variation.customCSS) {
      const style = doc.createElement('style');
      style.setAttribute('data-abt-css', variation.id);
      style.textContent = variation.customCSS;
      (doc.head ?? doc.documentElement).appendChild(style);
      a.cleanup.push(() => style.remove());
    }

    if (variation.operations.length) {
      const af = hide(
        doc,
        variation.operations.map((op) => op.target.selector),
        exp.antiFlicker.mode,
        exp.antiFlicker.timeoutMs,
      );
      a.cleanup.push(af.release);
      a.handle = applyOperations(variation.operations, {
        root: doc,
        timeoutMs: exp.antiFlicker.timeoutMs,
        persist: true,
        onApplied: (op, res) => {
          af.reveal(res.el);
          if (res.via !== 'primary')
            emit(exp, variation, {
              type: 'selector_healed',
              operationId: op.id,
              selector: op.target.selector,
              healedSelector: res.selector,
              via: res.via,
            });
        },
        onFailed: (op) =>
          emit(exp, variation, { type: 'selector_failed', operationId: op.id, selector: op.target.selector }),
      });
      a.handle.done.then(af.release);
    }

    if (variation.customJS) {
      const run = () => {
        if (active.get(exp.id) !== a) return;
        const s = doc.createElement('script');
        s.textContent = `try{${variation.customJS}\n}catch(e){console.error('[abtest] customJS',e)}`;
        doc.head.appendChild(s);
        s.remove();
      };
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run, { once: true });
      else run();
    }

    emit(exp, variation, { type: 'exposure' });
  };

  const evaluate = () => {
    const ctx = {
      url: win.location.href,
      device: detectDevice(nav.userAgent, win.innerWidth),
      isNew: visitor.isNew,
    };
    for (const exp of config.experiments) {
      if (exp.status !== 'running') continue;
      const forced = forcedOf(exp);
      if (!forced && !matchSegmentation(exp.segmentation, ctx)) {
        deactivate(exp.id);
        continue;
      }
      const variation = forced ?? assign(visitor.id, exp, stored);
      if (!variation) continue;
      if (active.get(exp.id)?.variation === variation) continue;
      deactivate(exp.id);
      activate(exp, variation);
    }
    saveAssignments(storage, stored);
  };

  evaluate();
  const onNavigate: Runtime['onNavigate'] = [];
  const unwatch = watchLocation(win, (url) => {
    evaluate();
    onNavigate.forEach((f) => f(url));
  });
  return {
    visitor,
    config,
    active,
    evaluate,
    emit,
    onNavigate,
    assigned: () =>
      config.experiments.flatMap((experiment) => {
        if (experiment.status !== 'running') return [];
        const variation =
          forcedOf(experiment) ?? experiment.variations.find((v) => v.id === stored[experiment.id]);
        return variation ? [{ experiment, variation }] : [];
      }),
    stop: () => {
      unwatch();
      [...active.keys()].forEach(deactivate);
    },
  };
}
