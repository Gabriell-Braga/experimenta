import { resolveTarget } from '@abtest/selector';
import { agentEvents, agentMethods, appMethods, createPeer, type ApplyResult } from '@abtest/shared';
import type { AgentBoot } from '@abtest/snippet/editor';
import { applyOperations, resetProcessed, type ApplyHandle } from '@abtest/snippet/engine';
import { watchLocation } from '@abtest/snippet/spa';
import { createEditing } from './editing';
import { createHeatmapLayer } from './heatmap';
import { elementInfo } from './inspect';
import { createOverlay } from './overlay';
import { heatmapContext, pageSnapshot } from './summary';

export const AGENT_VERSION = '0.1.0';

/** Eventos do site bloqueados no modo edição (cliques não navegam nem disparam handlers). */
const BLOCKED = [
  'click',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'dblclick',
  'submit',
  'contextmenu',
  'auxclick',
];

/** `parent`: janela do app (injetável nos testes). */
export function startAgent(win: Window, boot: AgentBoot, parent: Window = win.parent) {
  const doc = win.document;
  const overlay = createOverlay(doc);
  const heatmap = createHeatmapLayer(doc, overlay.root, (st) => peer.emit('heatmapStatus', st));
  let mode: 'edit' | 'browse' = 'edit';
  let selected: Element | null = null;
  let variation: { handle?: ApplyHandle; style?: HTMLStyleElement; script?: HTMLScriptElement } = {};

  const info = () => ({ version: AGENT_VERSION, url: win.location.href, title: doc.title });

  const select = (el: Element | null) => {
    selected = el;
    overlay.setSelected(el, (anc) => select(anc));
    peer.emit('selected', el ? elementInfo(el) : null);
  };

  const ours = (e: Event) => e.composedPath().some((n) => overlay.contains(n));

  const editing = createEditing({
    win,
    overlay,
    selected: () => selected,
    select: (el) => select(el),
    emit: (draft) => peer.emit('operation', { draft }),
    prompt: (kind, title, initial = '') => peer.call('prompt', { kind, title, initial }),
  });

  const onMove = (e: Event) => {
    if (mode !== 'edit' || ours(e)) return;
    overlay.setHover(e.target instanceof Element ? e.target : null);
  };
  const onBlocked = (e: Event) => {
    if (mode !== 'edit' || ours(e)) return;
    if (editing.isEditing(e.target)) {
      // Dentro do texto em edição: o site não recebe, mas o navegador posiciona o cursor normalmente.
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!(e.target instanceof Element)) return;
    if (e.type === 'click') {
      overlay.hideMenu();
      if (!editing.consumeClick()) select(e.target);
    } else if (e.type === 'dblclick') {
      select(e.target);
      editing.startEdit(e.target);
    } else if (e.type === 'contextmenu') {
      select(e.target);
      editing.openMenu(e.target, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    }
  };
  win.addEventListener('mouseover', onMove, true);
  for (const t of BLOCKED) win.addEventListener(t, onBlocked, true);
  doc.documentElement.addEventListener('mouseleave', () => overlay.setHover(null));

  // Mudanças no DOM (variação aplicada, re-render) movem os contornos.
  let raf = 0;
  const mo = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => overlay.refresh());
  });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  const applyVariation = async (p: {
    operations: Parameters<typeof applyOperations>[0];
    customCSS: string;
    customJS: string;
    runJS: boolean;
  }): Promise<ApplyResult> => {
    variation.handle?.revert();
    variation.style?.remove();
    resetProcessed();
    variation = {};
    if (p.customCSS) {
      variation.style = Object.assign(doc.createElement('style'), { textContent: p.customCSS });
      variation.style.setAttribute('data-abt-css', 'editor');
      doc.head.appendChild(variation.style);
    }
    variation.handle = applyOperations(p.operations, { root: doc, timeoutMs: 1500, persist: true });
    const report = await variation.handle.done;
    if (p.runJS && p.customJS) {
      const s = doc.createElement('script');
      s.textContent = `try{${p.customJS}\n}catch(e){console.error('[abtest] customJS',e)}`;
      doc.head.appendChild(s).remove();
    }
    // Se o elemento selecionado foi trocado/movido, re-resolve pelo seletor.
    if (selected && !selected.isConnected) {
      const r = resolveTarget(elementInfo(selected).target, doc);
      select(r?.el ?? null);
    } else overlay.refresh();
    return {
      applied: report.applied.map(({ op, res }) => ({ id: op.id, via: res.via })),
      failed: report.failed.map((op) => op.id),
    };
  };

  const peer = createPeer({
    self: win,
    remote: () => parent,
    origin: boot.appOrigin,
    localMethods: agentMethods,
    remoteMethods: appMethods,
    localEvents: agentEvents,
    remoteEvents: {},
    handlers: {
      ping: info,
      setMode: ({ mode: m }) => {
        mode = m;
        editing.finishEdit(true);
        overlay.hideMenu();
        overlay.setHover(null);
        if (m === 'browse') select(null);
        return {};
      },
      applyVariation,
      select: ({ selector }) => {
        const el = selector ? doc.querySelector(selector) : null;
        select(el);
        el?.scrollIntoView?.({ block: 'center' });
        return el ? elementInfo(el) : null;
      },
      showHeatmap: (data) => heatmap.show(data),
      pageSummary: () => pageSnapshot(doc),
      heatmapContext: ({ selectors }) => heatmapContext(doc, selectors),
      hideHeatmap: () => {
        heatmap.hide();
        return {};
      },
      highlight: ({ selector }) => {
        const el = selector ? (resolveTarget({ selector, alternates: [] }, doc)?.el ?? null) : null;
        overlay.setHover(el);
        return { found: !!el };
      },
    },
  });

  watchLocation(win, (url) => peer.emit('navigated', { url }));
  peer.emit('ready', info());

  return {
    peer,
    editing,
    destroy() {
      heatmap.hide();
      editing.destroy();
      peer.dispose();
      mo.disconnect();
      overlay.destroy();
      win.removeEventListener('mouseover', onMove, true);
      for (const t of BLOCKED) win.removeEventListener(t, onBlocked, true);
    },
    overlay,
    get selected() {
      return selected;
    },
    select,
  };
}
