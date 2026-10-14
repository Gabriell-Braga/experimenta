import type { ApplyResult, ElementInfo } from '@abtest/shared';
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { API_URL, createEditSession, frameUrl, publish, saveExperiment, type ExperimentRecord } from './api';
import { endExtensionSession, extCall, startExtensionSession } from './extension';
import { ChangesPanel } from './components/ChangesPanel';
import { PromptDialog, type PromptRequest } from './components/PromptDialog';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DEVICE_WIDTH, TopBar, type Device, type Mode } from './components/TopBar';
import { connectAgent, type AgentPeer } from './connection';
import { activeVariation, initialState, reducer } from './store';

// Monaco é pesado: só carrega quando a aba de código é aberta.
const CodePanel = lazy(() => import('./components/CodePanel'));
type Tab = 'element' | 'changes' | 'code' | 'settings';

interface Props {
  record: ExperimentRecord;
  accountId: string;
}

/** Sem `hello` do snippet nesse tempo, o site provavelmente bloqueia iframe ou não tem o snippet. */
const CONNECT_TIMEOUT_MS = 5000;

export function EditorView({ record, accountId }: Props) {
  const [state, dispatch] = useReducer(reducer, record, (r) => initialState(r.experiment, r.editorUrl));
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [mode, setMode] = useState<Mode>('edit');
  const [device, setDevice] = useState<Device>('desktop');
  const [selected, setSelected] = useState<ElementInfo | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [tab, setTab] = useState<Tab>('element');
  const [runJS, setRunJS] = useState(false);
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
      c.peer.on('selected', (info) => {
        setSelected(info);
        if (info) setTab('element');
      }),
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
        runJS,
      })
      .then(setApplyResult, () => {});
  }, [connected, readyCount, variation, runJS]);

  const [notice, setNotice] = useState<string | null>(null);
  /** Fallback da extensão: 'idle' → 'missing' (não instalada) | 'active' (sessão aberta; iframe recarregado). */
  const [ext, setExt] = useState<'idle' | 'missing' | 'active'>('idle');
  const [frameKey, setFrameKey] = useState(0);

  const tryExtension = useCallback(async () => {
    if (!token) return;
    if (!(await extCall('ping'))) return setExt('missing');
    const r = await startExtensionSession({ siteOrigin, token, accountId, apiUrl: API_URL });
    if (!r?.ok) return setError(`Extensão recusou a sessão: ${r?.error ?? 'sem resposta'}`);
    setExt('active');
    setFrameKey((k) => k + 1); // recarrega o iframe já com os headers liberados
  }, [token, siteOrigin, accountId]);

  // Não conectou a tempo → tenta a extensão automaticamente (uma vez).
  useEffect(() => {
    if (!token || connected || ext !== 'idle') return;
    const t = setTimeout(tryExtension, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [token, connected, ext, tryExtension, frameKey]);

  useEffect(() => () => void endExtensionSession(), []);
  const persist = useCallback(async () => {
    await saveExperiment({ experiment: state.experiment, projectId: record.projectId, editorUrl: state.url });
    dispatch({ type: 'saved' });
    setError(null);
  }, [state.experiment, state.url, record.projectId]);
  const save = useCallback(() => {
    persist().catch((e: Error) => setError(`Não foi possível salvar: ${e.message}`));
  }, [persist]);
  const doPublish = async () => {
    try {
      await persist();
      const { version } = await publish();
      setNotice(
        state.experiment.status === 'running'
          ? `Publicado (versão ${version}). Visitantes já recebem este experimento.`
          : `Publicado (versão ${version}), mas este experimento está "${state.experiment.status}" e não entra na publicação — mude o status em Config.`,
      );
    } catch (e) {
      setError(`Não foi possível publicar: ${e instanceof Error ? e.message : e}`);
    }
  };

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
        onPublish={doPublish}
        onUrl={(url) => {
          setConnected(false);
          dispatch({ type: 'setUrl', url });
        }}
      />
      {!connected && ext === 'missing' && (
        <div
          role="alert"
          className="bg-yellow-50 px-4 py-2 text-sm text-yellow-900"
          data-testid="ext-missing"
        >
          O site não respondeu ao editor: ele bloqueia iframes ou ainda não tem o snippet instalado. Instale a
          extensão do editor (apps/extension) e{' '}
          <button className="underline" onClick={tryExtension}>
            tente de novo
          </button>
          .
        </div>
      )}
      {ext === 'active' && (
        <div className="bg-blue-50 px-4 py-1 text-xs text-blue-800" data-testid="ext-active">
          Editando via extensão (headers de bloqueio de iframe removidos só nesta aba).
        </div>
      )}
      {error && (
        <div role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex justify-between bg-green-50 px-4 py-2 text-sm text-green-800"
          data-testid="notice"
        >
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Fechar">
            ✕
          </button>
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
              key={frameKey}
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
            <nav className="flex border-b border-gray-200 text-sm" role="tablist">
              {(
                [
                  ['element', 'Elemento'],
                  ['changes', `Alterações (${variation.operations.length})`],
                  ['code', 'CSS/JS'],
                  ['settings', 'Config'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  data-testid={`side-${id}`}
                  onClick={() => setTab(id)}
                  className={`flex-1 border-b-2 px-2 py-2 ${tab === id ? 'border-orange-500 font-medium' : 'border-transparent text-gray-500'}`}
                >
                  {label}
                  {id === 'changes' && applyResult && applyResult.failed.length > 0 && (
                    <span className="ml-1 text-red-600" title="Alterações que não encontraram o elemento">
                      ⚠{applyResult.failed.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {tab === 'element' &&
              (selected ? (
                <PropertiesPanel
                  info={selected}
                  operations={variation.operations}
                  onUpsert={(draft, coalesceKey) => dispatch({ type: 'upsertOperation', draft, coalesceKey })}
                  onSelectSelector={(selector) =>
                    peer.current?.call('select', { selector }).then(setSelected, () => {})
                  }
                />
              ) : (
                <p className="p-3 text-sm text-gray-500">Clique num elemento do site para editar.</p>
              ))}
            {tab === 'changes' && (
              <ChangesPanel
                operations={variation.operations}
                result={applyResult}
                onHighlight={(selector) => peer.current?.call('highlight', { selector }).catch(() => {})}
                onSelect={(selector) =>
                  peer.current?.call('select', { selector }).then(setSelected, () => {})
                }
                onRemove={(id) => dispatch({ type: 'removeOperation', id })}
                onMove={(id, to) => dispatch({ type: 'moveOperation', id, to })}
              />
            )}
            {tab === 'settings' && <SettingsPanel experiment={state.experiment} dispatch={dispatch} />}
            {tab === 'code' && (
              <Suspense fallback={<p className="p-3 text-sm text-gray-500">Carregando editor…</p>}>
                <CodePanel
                  key={variation.id}
                  css={variation.customCSS}
                  js={variation.customJS}
                  runJS={runJS}
                  onCSS={(value) => dispatch({ type: 'setCustom', field: 'customCSS', value })}
                  onJS={(value) => dispatch({ type: 'setCustom', field: 'customJS', value })}
                  onRunJS={setRunJS}
                />
              </Suspense>
            )}
          </aside>
        )}
      </div>
      <PromptDialog req={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
