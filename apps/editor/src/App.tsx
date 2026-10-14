import { Check, Ellipsis, FlaskConical, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  deleteExperiment,
  duplicateExperiment,
  getExperiment,
  getToken,
  listExperiments,
  listProjects,
  login,
  logout,
  me,
  saveExperiment,
  setStatus,
  type ExperimentRecord,
  type ExperimentSummary,
  type Me,
  type Project,
} from './api';
import { EditorView } from './EditorView';
import { expParam, go } from './nav';
import { newExperiment } from './store';
import { Button, inputCls, Logo, Modal, Spinner, StatusBadge, timeAgo, useToast } from './ui';

// ---------------------------------------------------------------- Login

function Login({ onLogin }: { onLogin(u: Me): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gray-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-gradient-to-br from-brand-500 to-rose-500 opacity-30 blur-3xl"
        />
        <Logo className="relative text-lg" />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold">
            Teste mudanças no seu site sem mexer no código.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-gray-300">
            {[
              ['Editor visual', 'clique, edite e arraste direto na página real'],
              ['Sem piscar', 'esconde só o elemento alterado enquanto a variação carrega'],
              ['Seletores que se curam', 'avisa e se recupera quando o site muda'],
              ['Mapa de calor', 'veja onde cada variação recebe cliques'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <Check size={18} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
                <span>
                  <b className="font-medium text-white">{t}</b> — {d}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-gray-500">Testes A/B com editor visual</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form
          className="w-full max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError(null);
            try {
              onLogin(await login(String(f.get('email')), String(f.get('password'))));
            } catch (err) {
              setError(
                err instanceof ApiError && err.status === 401
                  ? 'E-mail ou senha incorretos.'
                  : 'Não foi possível entrar. Tente de novo.',
              );
              setBusy(false);
            }
          }}
        >
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-1 text-sm text-gray-500">Acesse seus experimentos.</p>
          <div className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">E-mail</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                className={inputCls}
                aria-label="E-mail"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Senha</span>
              <span className="relative block">
                <input
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className={`${inputCls} pr-16`}
                  aria-label="Senha"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs text-gray-500 hover:bg-gray-100"
                >
                  {show ? 'ocultar' : 'mostrar'}
                </button>
              </span>
            </label>
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy} className="mt-6 w-full py-2.5">
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Shell

export function AppHeader({ user, children }: { user: Me; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button onClick={() => go(null)} className="shrink-0" aria-label="Início">
        <Logo />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-gray-100"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="user-menu"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-900 text-xs font-semibold text-white">
            {initials}
          </span>
          <span className="hidden text-sm text-gray-700 sm:inline">{user.name}</span>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-lg"
          >
            <div className="px-3 py-2 text-xs text-gray-500">
              {user.email}
              <br />
              Papel: <b className="text-gray-700">{user.role}</b>
            </div>
            <button
              role="menuitem"
              onClick={() => {
                logout();
                location.href = location.pathname;
              }}
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100"
            >
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- Lista

const FILTERS = [
  ['all', 'Todos'],
  ['running', 'Em execução'],
  ['draft', 'Rascunhos'],
  ['paused', 'Pausados'],
  ['archived', 'Arquivados'],
] as const;

function CreateModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!open) return;
    listProjects().then(
      (p) => {
        setProjects(p);
        setUrl((u) => u || p[0]?.siteUrl || '');
      },
      () => {},
    );
  }, [open]);
  const base = projects[0]?.siteUrl.replace(/\/$/, '') ?? '';
  const suggestions = base
    ? [
        ['Home', `${base}/`],
        ['Loja completa', `${base}/loja/`],
        ['SPA React', `${base}/spa/`],
      ]
    : [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo experimento"
      testId="create-modal"
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-form"
            variant="primary"
            loading={busy || !projects.length}
            data-testid="create-submit"
          >
            Criar e abrir editor
          </Button>
        </>
      }
    >
      <form
        id="create-form"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const project = projects[0];
          if (!project) return toast('error', 'Nenhum projeto encontrado nesta conta.');
          setBusy(true);
          try {
            const pageUrl = new URL(String(f.get('url'))).href;
            const experiment = newExperiment(pageUrl, String(f.get('name')).trim() || 'Novo experimento');
            await saveExperiment({ experiment, projectId: project.id, editorUrl: pageUrl }, true);
            go(experiment.id);
          } catch (err) {
            toast(
              'error',
              err instanceof TypeError
                ? 'URL inválida.'
                : `Não foi possível criar: ${(err as Error).message}`,
            );
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Nome</span>
          <input
            name="name"
            required
            autoFocus
            placeholder="Ex.: Botão de compra vermelho"
            className={inputCls}
            data-testid="create-name"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Página a editar</span>
          <input
            name="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputCls}
            data-testid="create-url"
          />
        </label>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {suggestions.map(([label, u]) => (
              <button
                key={u}
                type="button"
                onClick={() => setUrl(u!)}
                className={`rounded-full border px-2.5 py-1 ${url === u ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500">
          O experimento começa como rascunho com Controle e Variação 1 (50/50).
        </p>
      </form>
    </Modal>
  );
}

function RowActions({
  e,
  canEdit,
  onChanged,
}: {
  e: ExperimentSummary;
  canEdit: boolean;
  onChanged(): void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setOpen(false);
    setBusy(true);
    try {
      await fn();
      toast('success', label);
      onChanged();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!canEdit) return null;
  return (
    <div className="relative" onClick={(ev) => ev.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-label="Ações"
        loading={busy}
        data-testid="row-actions"
      >
        {!busy && <Ellipsis size={16} />}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-gray-200 bg-white p-1 text-left text-sm shadow-lg"
        >
          {e.status !== 'running' && e.status !== 'archived' && (
            <MenuItem
              onClick={() =>
                act('Experimento em execução. Publique para valer no site.', () => setStatus(e.id, 'running'))
              }
            >
              Iniciar
            </MenuItem>
          )}
          {e.status === 'running' && (
            <MenuItem
              onClick={() =>
                act('Experimento pausado. Publique para tirar do site.', () => setStatus(e.id, 'paused'))
              }
            >
              Pausar
            </MenuItem>
          )}
          <MenuItem onClick={() => act('Cópia criada como rascunho.', () => duplicateExperiment(e.id))}>
            Duplicar
          </MenuItem>
          {e.status !== 'archived' ? (
            <MenuItem onClick={() => act('Experimento arquivado.', () => setStatus(e.id, 'archived'))}>
              Arquivar
            </MenuItem>
          ) : (
            <MenuItem
              onClick={() => act('Experimento restaurado como rascunho.', () => setStatus(e.id, 'draft'))}
            >
              Desarquivar
            </MenuItem>
          )}
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
          >
            Excluir…
          </MenuItem>
        </div>
      )}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir experimento?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-delete"
              onClick={() => {
                setConfirmDelete(false);
                void act('Experimento excluído.', () => deleteExperiment(e.id));
              }}
            >
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          <b>{e.name}</b> e todo o histórico de versões serão apagados. Se ele estiver publicado, publique de
          novo para tirá-lo do site. Para guardar o histórico, prefira <b>Arquivar</b>.
        </p>
      </Modal>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100 ${danger ? 'text-red-600' : ''}`}
    >
      {children}
    </button>
  );
}

function ExperimentList({ user }: { user: Me }) {
  const toast = useToast();
  const [items, setItems] = useState<ExperimentSummary[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const canEdit = user.role !== 'viewer';
  const load = useCallback(() => {
    listExperiments().then(setItems, (e: Error) => toast('error', `Não foi possível carregar: ${e.message}`));
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = 'Experimentos — Experimenta';
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length ?? 0 };
    for (const e of items ?? []) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = (items ?? []).filter(
    (e) =>
      (filter === 'all' ? e.status !== 'archived' : e.status === filter) &&
      (!q || `${e.name} ${e.key} ${e.editorUrl}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="min-h-full">
      <AppHeader user={user} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Experimentos</h1>
            <p className="mt-1 text-sm text-gray-500">
              {counts.running ? `${counts.running} em execução · ` : ''}
              {counts.all} no total
            </p>
          </div>
          {canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-experiment">
              <Plus size={16} aria-hidden="true" /> Novo experimento
            </Button>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div
            className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1"
            role="tablist"
            aria-label="Filtrar por status"
          >
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
                className={`rounded-md px-3 py-1 text-sm ${filter === id ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                {label}
                {id !== 'all' && counts[id] ? (
                  <span className="ml-1 text-xs text-gray-400">{counts[id]}</span>
                ) : null}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, chave ou página…"
            className={`${inputCls} max-w-xs`}
            aria-label="Buscar"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="experiment-list">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Experimento</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Página</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Variações</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Tráfego</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Atualizado</th>
                <th className="w-12 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items === null &&
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }, (__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="skeleton h-4" />
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}
              {shown.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => go(e.id)}
                  className="group cursor-pointer hover:bg-gray-50"
                  data-testid="experiment-row"
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-medium text-gray-900 group-hover:text-brand-600"
                      onClick={() => go(e.id)}
                    >
                      {e.name}
                    </button>
                    <div className="font-mono text-xs text-gray-400">{e.key}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="hidden max-w-xs px-4 py-3 md:table-cell">
                    <span className="block truncate text-gray-600" title={e.editorUrl}>
                      {e.editorUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-gray-600 sm:table-cell">{e.variations}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <span className="flex items-center gap-2 text-gray-600">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                        <span className="block h-full bg-brand-500" style={{ width: `${e.traffic}%` }} />
                      </span>
                      {e.traffic}%
                    </span>
                  </td>
                  <td
                    className="hidden px-4 py-3 whitespace-nowrap text-gray-500 sm:table-cell"
                    title={new Date(e.updatedAt).toLocaleString('pt-BR')}
                  >
                    {timeAgo(e.updatedAt)}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <RowActions e={e} canEdit={canEdit} onChanged={load} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items !== null && shown.length === 0 && (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
                <FlaskConical size={22} aria-hidden="true" />
              </div>
              <p className="mt-4 font-medium">
                {items.length ? 'Nada encontrado com esse filtro.' : 'Nenhum experimento ainda.'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {items.length
                  ? 'Ajuste a busca ou o filtro.'
                  : 'Crie o primeiro e edite a página direto no editor visual.'}
              </p>
              {!items.length && canEdit && (
                <Button variant="primary" className="mt-6" onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden="true" /> Novo experimento
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
      <CreateModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- Raiz

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-full place-items-center text-gray-500">
      <span className="flex items-center gap-2 text-sm">
        <Spinner /> {label}
      </span>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<Me | null | undefined>(getToken() ? undefined : null);
  const [exp, setExp] = useState(expParam);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === undefined) me().then(setUser, () => setUser(null));
  }, [user]);
  useEffect(() => {
    const onPop = () => setExp(expParam());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    setRecord(null);
    setError(null);
    if (!user || !exp) return;
    getExperiment(exp).then(setRecord, (e: Error) =>
      setError(e instanceof ApiError && e.status === 404 ? 'Experimento não encontrado.' : e.message),
    );
  }, [user, exp]);

  if (user === undefined) return <FullPageSpinner label="Carregando…" />;
  if (!user) return <Login onLogin={setUser} />;
  if (!exp) return <ExperimentList user={user} />;
  if (error)
    return (
      <div className="grid min-h-full place-items-center">
        <div className="text-center">
          <p role="alert" className="text-red-600">
            {error}
          </p>
          <Button className="mt-4" onClick={() => go(null)}>
            Voltar aos experimentos
          </Button>
        </div>
      </div>
    );
  return record ? (
    <EditorView key={record.experiment.id} record={record} user={user} />
  ) : (
    <FullPageSpinner label="Abrindo experimento…" />
  );
}
