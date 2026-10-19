import { Ellipsis, FlaskConical, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteExperiment,
  duplicateExperiment,
  listExperiments,
  listProjects,
  saveExperiment,
  setStatus,
  type ExperimentSummary,
  type Me,
  type Project,
} from '../api';
import { go } from '../nav';
import { newExperiment } from '../store';
import {
  Button,
  EmptyState,
  inputCls,
  Modal,
  PageHeader,
  Segmented,
  StatusBadge,
  timeAgo,
  useToast,
} from '../ui';

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
                className={`rounded-sm border px-2.5 py-1 font-mono ${url === u ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
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
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-gray-900/10 bg-white p-1 text-left text-sm shadow-lg"
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
      className={`w-full rounded px-3 py-2 text-left hover:bg-gray-100 ${danger ? 'text-signal' : ''}`}
    >
      {children}
    </button>
  );
}

/** Chips C / V1 / V2… (controle e variações). */
export function VariationChips({ count }: { count: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${count} variações`}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`grid h-5 min-w-5 place-items-center rounded-sm px-1 font-mono text-[10px] font-semibold ${i === 0 ? 'bg-gray-100 text-gray-600' : 'bg-ink text-lime'}`}
        >
          {i === 0 ? 'C' : `V${i}`}
        </span>
      ))}
    </span>
  );
}

export function ExperimentList({ user }: { user: Me }) {
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
    <>
      <PageHeader
        eyebrow="Testes"
        title="Experimentos"
        description={
          <span className="tabular font-mono text-xs text-gray-500">
            {counts.running ?? 0} em execução / {counts.all} no total
          </span>
        }
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-experiment">
              <Plus size={16} aria-hidden="true" /> Novo experimento
            </Button>
          )
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented<(typeof FILTERS)[number][0]>
          label="Filtrar por status"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map(
            ([id, label]) =>
              [
                id,
                <>
                  {label}
                  {id !== 'all' && counts[id] ? (
                    <span className="tabular ml-1.5 font-mono text-[11px] opacity-60">{counts[id]}</span>
                  ) : null}
                </>,
              ] as const,
          )}
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, chave ou página…"
          className={`${inputCls} max-w-xs`}
          aria-label="Buscar"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-900/10 bg-white">
        <table className="w-full text-left text-sm" data-testid="experiment-list">
          <thead className="border-b border-gray-900/10 bg-gray-50">
            <tr className="label-mono">
              <th className="px-4 py-2.5 font-medium">Experimento</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Página</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Variações</th>
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Tráfego</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Atualizado</th>
              <th className="w-12 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-900/[0.06]">
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
                className="group cursor-pointer hover:bg-lime-soft/40"
                data-testid="experiment-row"
              >
                <td className="px-4 py-3">
                  <button
                    className="text-left font-medium text-ink decoration-lime decoration-2 underline-offset-4 group-hover:underline"
                    onClick={() => go(e.id)}
                  >
                    {e.name}
                  </button>
                  <div className="font-mono text-[11px] text-gray-400">{e.key}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                <td className="hidden max-w-xs px-4 py-3 md:table-cell">
                  <span className="block truncate font-mono text-xs text-gray-600" title={e.editorUrl}>
                    {e.editorUrl.replace(/^https?:\/\//, '')}
                  </span>
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <VariationChips count={e.variations} />
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <span className="flex items-center gap-2 text-gray-600">
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-gray-100">
                      <span className="block h-full bg-brand-500" style={{ width: `${e.traffic}%` }} />
                    </span>
                    <span className="tabular font-mono text-xs">{e.traffic}%</span>
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
          <EmptyState
            icon={<FlaskConical size={20} aria-hidden="true" />}
            title={items.length ? 'Nada encontrado com esse filtro.' : 'Nenhum experimento ainda.'}
            action={
              !items.length &&
              canEdit && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden="true" /> Novo experimento
                </Button>
              )
            }
          >
            {items.length
              ? 'Ajuste a busca ou o filtro.'
              : 'Crie o primeiro e edite a página direto no editor visual.'}
          </EmptyState>
        )}
      </div>
      <CreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
