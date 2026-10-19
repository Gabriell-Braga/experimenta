import { GripVertical, MousePointer2, MousePointerClick, TriangleAlert, X } from 'lucide-react';
import { selectorFragility } from '@abtest/selector';
import { matchUrl } from '@abtest/snippet/segment';
import type { ApplyResult, ElementInfo, HeatmapMode } from '@abtest/shared';
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  API_URL,
  createEditSession,
  frameUrl,
  getConflicts,
  getHeatmap,
  publish,
  saveExperiment,
  type Conflict,
  type ExperimentRecord,
  type HeatmapFilters,
  type Me,
} from './api';
import { go, navigate } from './nav';
import { Button, Modal, Spinner, useToast } from './ui';
import { endExtensionSession, extCall, startExtensionSession } from './extension';
import { ChangesPanel } from './components/ChangesPanel';
import { HealthPanel } from './components/HealthPanel';
import { HeatmapPanel, type HeatmapResult } from './components/HeatmapPanel';
import { PromptDialog, type PromptRequest } from './components/PromptDialog';
import { PropertiesPanel } from './components/PropertiesPanel';
import { EMPTY_GOAL, SettingsPanel, type GoalDraft } from './components/SettingsPanel';
import { VersionsPanel } from './components/VersionsPanel';
import { DEVICE_WIDTH, TopBar, type Device, type Mode } from './components/TopBar';
import { connectAgent, type AgentPeer } from './connection';
import { activeVariation, initialState, reducer } from './store';

// Monaco é pesado: só carrega quando a aba de código é aberta.
const CodePanel = lazy(() => import('./components/CodePanel'));
type Tab = 'element' | 'changes' | 'code' | 'health' | 'versions';

interface Props {
  record: ExperimentRecord;
  user: Me;
}

/** Sem `hello` do snippet nesse tempo, o site provavelmente bloqueia iframe ou não tem o snippet. */
const CONNECT_TIMEOUT_MS = 5000;

export function EditorView({ record, user }: Props) {
  const accountId = user.accountId;
  const toast = useToast();
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
  /** Configurações (status, tráfego, páginas, metas) ficam numa janela própria, fora da edição. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goal, setGoal] = useState<GoalDraft>(EMPTY_GOAL);
  /** "Escolher no site": o próximo elemento selecionado vira o seletor da meta. */
  const picking = useRef(false);
  const [pickingGoal, setPickingGoal] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const peer = useRef<AgentPeer | null>(null);
  const variation = activeVariation(state);
  const siteOrigin = new URL(state.url).origin;
  /**
   * URL carregada no iframe (só muda quando o usuário digita outra). `state.url` acompanha a página ATUAL
   * (navegação dentro do iframe chega pelo `ready`/`navigated`) sem recarregar o iframe.
   */
  const [frameSrcUrl, setFrameSrcUrl] = useState(state.url);

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
      c.peer.on('ready', ({ url }) => {
        const clean = new URL(url);
        clean.searchParams.delete('abt_edit');
        dispatch({ type: 'setUrl', url: clean.href });
        setConnected(true);
        setReadyCount((n) => n + 1); // cada navegação do iframe gera novo ready → reenviar estado
      }),
      c.peer.on('selected', (info) => {
        if (picking.current && info) {
          picking.current = false;
          setPickingGoal(false);
          setGoal((g) => ({ ...g, value: info.target.selector }));
          setSettingsOpen(true);
          return;
        }
        setSelected(info);
        if (info) setTab('element');
      }),
      c.peer.on('operation', ({ draft }) => {
        dispatch({ type: 'addOperation', draft });
        if (selectorFragility(draft.target.selector) === 'high') setFragileWarning(draft.target.selector);
      }),
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

  // Mapa de calor: filtros, dados da API e quantos seletores não existem na página atual.
  const [heatFilters, setHeatFilters] = useState<HeatmapFilters>({});
  const [heat, setHeat] = useState<HeatmapResult | null>(null);
  const [heatMode, setHeatMode] = useState<HeatmapMode>('heat');
  const [heatMissing, setHeatMissing] = useState(0);
  useEffect(() => {
    if (!connected) return;
    if (mode !== 'heatmap') {
      peer.current?.call('hideHeatmap', {}).catch(() => {});
      return;
    }
    let live = true;
    setHeat(null);
    const filters = heatFilters.variationId
      ? { ...heatFilters, experimentId: state.experiment.id }
      : heatFilters;
    getHeatmap(state.url, filters)
      .then((data) => live && setHeat(data))
      .catch((e: Error) => toast('error', `Mapa de calor: ${e.message}`));
    return () => {
      live = false;
    };
  }, [mode, connected, readyCount, heatFilters, state.url, state.experiment.id]);
  // Desenha (ou redesenha ao trocar o tipo de mapa, sem buscar de novo).
  useEffect(() => {
    if (!connected || mode !== 'heatmap' || !heat) return;
    const { page: _page, ...data } = heat;
    peer.current?.call('showHeatmap', { ...data, mode: heatMode }).then(
      (r) => setHeatMissing(r.missing),
      () => {},
    );
  }, [connected, mode, heat, heatMode]);
  /** Seletor frágil da última alteração criada (aviso até o usuário fechar). */
  const [fragileWarning, setFragileWarning] = useState<string | null>(null);
  /** Fallback da extensão: 'idle' → 'missing' (não instalada) | 'active' (sessão aberta; iframe recarregado). */
  const [ext, setExt] = useState<'idle' | 'missing' | 'active'>('idle');
  const [frameKey, setFrameKey] = useState(0);

  const tryExtension = useCallback(async () => {
    if (!token) return;
    if (!(await extCall('ping'))) return setExt('missing');
    const r = await startExtensionSession({ siteOrigin, token, accountId, apiUrl: API_URL });
    if (!r?.ok) return toast('error', `Extensão recusou a sessão: ${r?.error ?? 'sem resposta'}`);
    setExt('active');
    setFrameKey((k) => k + 1); // recarrega o iframe já com os headers liberados
  }, [token, siteOrigin, accountId, toast]);

  // Extensão instalada → abre a sessão ANTES de carregar o iframe: headers de bloqueio removidos e cookies do
  // site com SameSite=None (usuário continua logado no site dentro do editor). Sem extensão: segue direto.
  const [extChecked, setExtChecked] = useState(false);
  useEffect(() => {
    if (!token) return;
    let live = true;
    // Domínio novo: segura o iframe até a sessão da extensão valer para ele (cookies/headers liberados antes).
    setExtChecked(false);
    (async () => {
      if (await extCall('ping')) {
        const r = await startExtensionSession({ siteOrigin, token, accountId, apiUrl: API_URL });
        if (live && r?.ok) setExt('active');
      }
      if (live) setExtChecked(true);
    })();
    return () => {
      live = false;
    };
  }, [token, siteOrigin, accountId]);

  // Não conectou a tempo → tenta a extensão automaticamente (uma vez).
  useEffect(() => {
    if (!token || connected || ext !== 'idle') return;
    const t = setTimeout(tryExtension, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [token, connected, ext, tryExtension, frameKey]);

  useEffect(() => () => void endExtensionSession(), []);
  // Conflitos são calculados pela API sobre a versão SALVA (recarregados ao abrir e a cada salvamento).
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const loadConflicts = useCallback(
    () => getConflicts(record.experiment.id).then(setConflicts, () => {}),
    [record.experiment.id],
  );
  useEffect(() => void loadConflicts(), [loadConflicts]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  /** Grava na API só se houver mudança. Conflitos são recarregados em segundo plano (não seguram o botão). */
  const persist = useCallback(async () => {
    if (!state.dirty) return null;
    const r = await saveExperiment({
      experiment: state.experiment,
      projectId: record.projectId,
      editorUrl: state.url,
    });
    dispatch({ type: 'saved' });
    setSavedAt(new Date().toISOString());
    void loadConflicts();
    return r.version;
  }, [state.dirty, state.experiment, state.url, record.projectId, loadConflicts]);

  const save = useCallback(async () => {
    if (saving || !state.dirty) return;
    setSaving(true);
    try {
      const v = await persist();
      toast('success', v ? `Salvo (versão ${v}).` : 'Nada para salvar.');
    } catch (e) {
      toast('error', `Não foi possível salvar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [saving, state.dirty, persist, toast]);

  const doPublish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      await persist();
      const { version } = await publish();
      const running = state.experiment.status === 'running';
      toast(
        running ? 'success' : 'info',
        running
          ? `Publicado (versão ${version}). Visitantes recebem o experimento em até 1 min.`
          : `Publicado (versão ${version}), mas este experimento está "${state.experiment.status}" e não entra na publicação — mude o status em Configurações.`,
        running
          ? { label: 'Ver no site', href: state.url }
          : { label: 'Abrir configurações', onClick: () => setSettingsOpen(true) },
      );
      // Aviso de conflito depois, sem atrasar a confirmação da publicação.
      getConflicts(record.experiment.id).then(
        (list) => {
          const live = list.filter((c) => c.status === 'running');
          if (running && live.length)
            toast(
              'error',
              `Conflito: ${live.map((c) => `"${c.name}"`).join(', ')} também altera(m) os mesmos elementos e está(ão) em execução.`,
            );
        },
        () => {},
      );
    } catch (e) {
      toast('error', `Não foi possível publicar: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  // Fechar/recarregar a aba com alterações não salvas: o navegador pergunta.
  useEffect(() => {
    if (!state.dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', onUnload);
    return () => removeEventListener('beforeunload', onUnload);
  }, [state.dirty]);

  /** A página aberta casa com as regras de URL do experimento? (mesma lógica do snippet) */
  const pageInSegmentation = (() => {
    const urls = state.experiment.segmentation.urls;
    if (urls.some((r) => r.exclude && matchUrl(r, state.url))) return false;
    const inc = urls.filter((r) => !r.exclude);
    return !inc.length || inc.some((r) => matchUrl(r, state.url));
  })();

  useEffect(() => {
    document.title = `${state.dirty ? '● ' : ''}${state.experiment.name} — Experimenta`;
  }, [state.dirty, state.experiment.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input,textarea,.monaco-editor'))
        return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  return (
    <div className="flex h-screen flex-col bg-paper text-gray-900">
      <TopBar
        name={state.experiment.name}
        status={state.experiment.status}
        type={state.experiment.type}
        saving={saving}
        publishing={publishing}
        savedAt={savedAt}
        onBack={() => (state.dirty ? setLeaving(true) : go(null))}
        onRename={(name) => dispatch({ type: 'patchExperiment', patch: { name } })}
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
        onSave={() => void save()}
        onPublish={doPublish}
        onSettings={() => setSettingsOpen(true)}
        onReport={() => (state.dirty ? setLeaving(true) : navigate('report', { id: state.experiment.id }))}
        onUrl={(url) => {
          setConnected(false);
          setFrameSrcUrl(url);
          dispatch({ type: 'setUrl', url });
          // Segmentação ainda é a padrão (só a página inicial)? Acompanha a nova página.
          const urls = state.experiment.segmentation.urls;
          const only = urls.length === 1 ? urls[0] : undefined;
          if (
            only &&
            only.match === 'exact' &&
            !only.exclude &&
            only.value === state.url &&
            url !== state.url
          ) {
            dispatch({
              type: 'patchExperiment',
              patch: { segmentation: { ...state.experiment.segmentation, urls: [{ ...only, value: url }] } },
            });
            toast(
              'info',
              `O experimento agora roda em ${url.replace(/^https?:[/][/]/, '')} (ajuste em Configurações).`,
            );
          }
        }}
      />
      {!connected && ext === 'missing' && (
        <div
          role="alert"
          className="bg-yellow-50 px-4 py-2 text-sm text-yellow-900"
          data-testid="ext-missing"
        >
          O site não respondeu ao editor: ele bloqueia iframes ou ainda não tem o snippet instalado.{' '}
          <a className="underline" href="/abtest-extension.zip" download>
            Baixe a extensão
          </a>{' '}
          (descompacte → chrome://extensions → modo desenvolvedor → “Carregar sem compactação”) e{' '}
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
      {fragileWarning && (
        <div
          role="alert"
          className="flex justify-between gap-2 bg-yellow-50 px-4 py-2 text-sm text-yellow-900"
          data-testid="fragile-warning"
        >
          <span>
            <TriangleAlert size={15} className="mr-1 inline align-[-2px]" aria-hidden="true" />
            Alteração com seletor frágil (<code>{fragileWarning}</code>): depende da posição ou de classes
            geradas e pode quebrar quando o site mudar. Peça ao time do site um <code>id</code> ou{' '}
            <code>data-testid</code> estável nesse elemento — a impressão digital tenta curar, mas não é
            garantida.
          </span>
          <button onClick={() => setFragileWarning(null)} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      )}
      {!pageInSegmentation && (
        <div
          className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          data-testid="segment-warning"
        >
          <span>
            <TriangleAlert size={15} className="mr-1 inline align-[-2px]" aria-hidden="true" />
            Esta página não está na segmentação do experimento: visitantes aqui <b>não</b> verão as
            alterações.
          </span>
          <Button
            size="sm"
            onClick={() =>
              dispatch({
                type: 'patchExperiment',
                patch: {
                  segmentation: {
                    ...state.experiment.segmentation,
                    urls: [
                      ...state.experiment.segmentation.urls,
                      { match: 'exact', value: state.url, exclude: false },
                    ],
                  },
                },
              })
            }
          >
            Incluir esta página
          </Button>
        </div>
      )}
      {pickingGoal && (
        <div
          className="flex items-center justify-between gap-3 bg-brand-50 px-4 py-2 text-sm text-brand-900"
          data-testid="goal-picking"
        >
          <span>
            <MousePointerClick size={15} className="mr-1 inline align-[-2px]" aria-hidden="true" />
            Clique no elemento da meta no site.
          </span>
          <Button
            size="sm"
            onClick={() => {
              picking.current = false;
              setPickingGoal(false);
              setSettingsOpen(true);
            }}
          >
            Cancelar
          </Button>
        </div>
      )}
      {variation.redirect && (
        <div className="bg-brand-50 px-4 py-1.5 text-sm text-brand-900" data-testid="redirect-banner">
          <b>{variation.name}</b> redireciona os visitantes para{' '}
          <code className="font-mono text-xs">{variation.redirect.url}</code>. Alterações visuais aqui não
          valem para ela — mude o destino em Configurações.
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
        <main className="grid-paper relative flex min-w-0 flex-1 justify-center overflow-auto bg-gray-100 p-3">
          {!connected && ext !== 'missing' && !error && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-gray-100/70 backdrop-blur-[1px]">
              <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm text-gray-600 shadow-lg">
                <Spinner className="h-5 w-5 text-brand-500" />
                <span>
                  Conectando ao site…
                  <span className="block text-xs text-gray-400">
                    {state.url.replace(/^https?:[/][/]/, '')}
                  </span>
                </span>
              </div>
            </div>
          )}
          {token && extChecked && (
            <iframe
              ref={iframe}
              key={frameKey}
              title="Site em edição"
              data-testid="site-frame"
              src={frameUrl(frameSrcUrl, token)}
              style={{ width: DEVICE_WIDTH[device] }}
              className="h-full max-w-full rounded-md border-0 bg-white shadow-[0_10px_30px_-12px_rgb(22_24_29/0.35)] ring-1 ring-gray-900/10 transition-[width]"
            />
          )}
        </main>
        {mode === 'heatmap' && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
            <HeatmapPanel
              mode={heatMode}
              onMode={setHeatMode}
              variations={state.experiment.variations}
              filters={heatFilters}
              onFilters={setHeatFilters}
              data={heat}
              missing={heatMissing}
              onHighlight={(selector) => peer.current?.call('highlight', { selector }).catch(() => {})}
            />
          </aside>
        )}
        {mode !== 'preview' && mode !== 'heatmap' && (
          <aside
            className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white xl:w-96"
            data-testid="sidebar"
          >
            <nav
              className="flex flex-wrap border-b border-gray-900/10 bg-white px-2 text-[12.5px]"
              role="tablist"
            >
              {(
                [
                  ['element', 'Elemento'],
                  ['changes', `Alterações (${variation.operations.length})`],
                  ['code', 'CSS/JS'],
                  ['health', 'Saúde'],
                  ['versions', 'Versões'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  data-testid={`side-${id}`}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-2 py-2.5 whitespace-nowrap ${tab === id ? 'border-ink font-medium text-ink' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                >
                  {label}
                  {id === 'changes' && applyResult && applyResult.failed.length > 0 && (
                    <span className="ml-1 text-red-600" title="Alterações que não encontraram o elemento">
                      <TriangleAlert size={12} className="inline align-[-1px]" aria-hidden="true" />
                      {applyResult.failed.length}
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
                <div className="p-6 text-center text-sm text-gray-500">
                  <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md bg-ink text-lime">
                    <MousePointer2 size={18} aria-hidden="true" />
                  </div>
                  <p className="font-medium text-gray-700">Selecione um elemento</p>
                  <p className="mt-1">
                    Clique para selecionar, duplo clique para editar o texto, botão direito para mais opções e
                    a alça <GripVertical size={13} className="inline align-[-2px]" aria-label="alça" /> para
                    arrastar.
                  </p>
                </div>
              ))}
            {tab === 'changes' && (
              <ChangesPanel
                operations={variation.operations}
                conflicts={conflicts}
                result={applyResult}
                onHighlight={(selector) => peer.current?.call('highlight', { selector }).catch(() => {})}
                onSelect={(selector) =>
                  peer.current?.call('select', { selector }).then(setSelected, () => {})
                }
                onRemove={(id) => dispatch({ type: 'removeOperation', id })}
                onMove={(id, to) => dispatch({ type: 'moveOperation', id, to })}
              />
            )}
            {tab === 'versions' && (
              <VersionsPanel
                experimentId={state.experiment.id}
                dirty={state.dirty}
                onRestored={() => location.reload()}
              />
            )}
            {tab === 'health' && (
              <HealthPanel
                experimentId={state.experiment.id}
                variation={variation}
                onHighlight={(selector) => peer.current?.call('highlight', { selector }).catch(() => {})}
                onAdopt={(op, selector) =>
                  dispatch({
                    type: 'updateOperation',
                    id: op.id,
                    draft: {
                      ...op,
                      target: {
                        ...op.target,
                        selector,
                        alternates: [
                          op.target.selector,
                          ...op.target.alternates.filter((a) => a !== selector),
                        ],
                      },
                    },
                  })
                }
              />
            )}
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
      {settingsOpen && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-ink/50 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Configurações do experimento"
            data-testid="settings-modal"
            className="flex max-h-[90vh] w-[min(56rem,100%)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="font-display text-lg">Configurações do experimento</h2>
                <p className="text-xs text-gray-500">
                  Quem entra, em quais páginas e o que conta como conversão. Salve para gravar.
                </p>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Fechar"
                data-testid="settings-close"
              >
                <X size={16} />
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-4">
              <SettingsPanel
                experiment={state.experiment}
                dispatch={dispatch}
                goal={goal}
                onGoal={setGoal}
                onPick={() => {
                  picking.current = true;
                  setPickingGoal(true);
                  setSettingsOpen(false);
                  setMode('edit');
                }}
              />
            </div>
            <footer className="flex justify-end border-t border-gray-100 bg-gray-50 px-5 py-3">
              <Button variant="primary" onClick={() => setSettingsOpen(false)} data-testid="settings-done">
                Concluir
              </Button>
            </footer>
          </div>
        </div>
      )}
      <Modal
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Sair sem salvar?"
        testId="leave-modal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={() => go(null)} data-testid="leave-discard">
              Descartar
            </Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await persist();
                  go(null);
                } catch (e) {
                  toast('error', `Não foi possível salvar: ${(e as Error).message}`);
                  setSaving(false);
                }
              }}
            >
              Salvar e sair
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">Há alterações que ainda não foram salvas neste experimento.</p>
      </Modal>
    </div>
  );
}
