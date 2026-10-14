import type { ApplyResult, ElementInfo } from '@abtest/shared';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createEditSession, DEFAULT_SITE_URL, frameUrl, loadDraft, saveDraft } from './api';
import { PromptDialog, type PromptRequest } from './components/PromptDialog';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DEVICE_WIDTH, TopBar, type Device, type Mode } from './components/TopBar';
import { connectAgent, type AgentPeer } from './connection';
import { activeVariation, initialState, newExperiment, reducer } from './store';

function boot() {
  const draft = loadDraft();
  return draft
    ? initialState(draft.experiment, draft.url)
    : initialState(newExperiment(DEFAULT_SITE_URL), DEFAULT_SITE_URL);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, boot);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [mode, setMode] = useState<Mode>('edit');
  const [device, setDevice] = useState<Device>('desktop');
  const [selected, setSelected] = useState<ElementInfo | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const peer = useRef<AgentPeer | null>(null);
  const variation = activeVariation(state);
  const siteOrigin = new URL(state.url).origin;

  useEffect(() => {
    createEditSession().then(setToken, (e: Error) => setError(e.message));
  }, []);

  // Conexão com o agent (refeita quando muda o origin do site).
  useEffect(() => {
    if (!token) return;
    const c = connectAgent({
      frame: () => iframe.current?.contentWindow,
      siteOrigin,
      token,
      onPrompt: (kind, title, initial) =>
        new Promise((resolve) => setPrompt({ kind, title, initial, resolve })),
    });
    peer.current = c.peer;
    const offs = [
      c.peer.on('ready', () => {
        setConnected(true);
        setReadyCount((n) => n + 1); // cada navegação do iframe gera novo ready → reenviar estado
      }),
      c.peer.on('selected', setSelected),
      c.peer.on('operation', ({ draft }) => dispatch({ type: 'addOperation', draft })),
      c.peer.on('navigated', ({ url }) => dispatch({ type: 'setUrl', url })),
    ];
    return () => {
      offs.forEach((f) => f());
      c.dispose();
      peer.current = null;
      setConnected(false);
    };
  }, [token, siteOrigin]);

  // Modo e variação: reenviados a cada mudança e a cada (re)conexão.
  useEffect(() => {
    if (!connected) return;
    peer.current?.call('setMode', { mode: mode === 'edit' ? 'edit' : 'browse' }).catch(() => {});
  }, [connected, readyCount, mode]);

  useEffect(() => {
    if (!connected) return;
    peer.current
      ?.call('applyVariation', {
        operations: variation.operations,
        customCSS: variation.customCSS,
        customJS: variation.customJS,
        runJS: false,
      })
      .then(setApplyResult, () => {});
  }, [connected, readyCount, variation]);

  const save = useCallback(() => {
    saveDraft(state.experiment, state.url);
    dispatch({ type: 'saved' });
  }, [state.experiment, state.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input,textarea,.monaco-editor'))
        return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900">
      <TopBar
        name={state.experiment.name}
        variations={state.experiment.variations}
        activeId={state.activeVariationId}
        mode={mode}
        device={device}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        dirty={state.dirty}
        connected={connected}
        url={state.url}
        onSelectVariation={(id) => dispatch({ type: 'selectVariation', id })}
        onAddVariation={() => dispatch({ type: 'addVariation' })}
        onMode={setMode}
        onDevice={setDevice}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onSave={save}
        onUrl={(url) => {
          setConnected(false);
          dispatch({ type: 'setUrl', url });
        }}
      />
      {error && (
        <div role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {mode === 'preview' && (
        <div
          className="bg-orange-50 px-4 py-1 text-center text-sm text-orange-800"
          data-testid="preview-banner"
        >
          Preview de <b>{variation.name}</b> — o site funciona normalmente. Volte para “Editar” para alterar.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 justify-center overflow-auto bg-gray-200 p-3">
          {token && (
            <iframe
              ref={iframe}
              title="Site em edição"
              data-testid="site-frame"
              src={frameUrl(state.url, token)}
              style={{ width: DEVICE_WIDTH[device] }}
              className="h-full max-w-full rounded border-0 bg-white shadow transition-[width]"
            />
          )}
        </main>
        {mode !== 'preview' && (
          <aside
            className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white"
            data-testid="sidebar"
          >
            {selected ? (
              <PropertiesPanel
                info={selected}
                operations={variation.operations}
                onUpsert={(draft, coalesceKey) => dispatch({ type: 'upsertOperation', draft, coalesceKey })}
                onSelectSelector={(selector) =>
                  peer.current?.call('select', { selector }).then(setSelected, () => {})
                }
              />
            ) : (
              <p className="border-b p-3 text-sm text-gray-500">Clique num elemento do site para editar.</p>
            )}
            <section className="p-3 text-sm">
              <h2 className="mb-1 font-semibold">Alterações ({variation.operations.length})</h2>
              {applyResult && applyResult.failed.length > 0 && (
                <p className="text-red-600">
                  {applyResult.failed.length} alteração(ões) não encontraram o elemento.
                </p>
              )}
            </section>
          </aside>
        )}
      </div>
      <PromptDialog req={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
