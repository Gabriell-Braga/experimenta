import { BarChart3, CalendarClock, Ellipsis, FlaskConical, Layers, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteExperiment,
  duplicateExperiment,
  entities,
  listExperiments,
  listProjects,
  saveExperiment,
  schedules,
  setStatus,
  type Schedule,
  type ExperimentSummary,
  type Me,
  type Project,
} from '../api';
import type { CampaignType, Group } from '@abtest/shared';
import { CAMPAIGN_ORDER, CAMPAIGNS } from '../campaigns';
import { scheduleLabel, ScheduleModal } from '../components/Schedules';
import { go, navigate } from '../nav';
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

function CreateModal({
  open,
  onClose,
  initialType = 'ab',
}: {
  open: boolean;
  onClose(): void;
  initialType?: CampaignType;
}) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [splitUrl, setSplitUrl] = useState('');
  const [type, setType] = useState<CampaignType>(initialType);
  useEffect(() => {
    if (!open) return;
    setType(initialType);
    listProjects().then(
      (p) => {
        setProjects(p);
        setUrl((u) => u || p[0]?.siteUrl || '');
      },
      () => {},
    );
  }, [open, initialType]);
  const base = projects[0]?.siteUrl.replace(/\/$/, '') ?? '';
  const suggestions = base
    ? [
        ['Home', `${base}/`],
        ['Loja completa', `${base}/loja/`],
        ['SPA React', `${base}/spa/`],
      ]
    : [];
  const visual = type !== 'server';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova campanha"
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
            {visual ? 'Criar e abrir editor' : 'Criar'}
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
            const pageUrl = new URL(visual ? String(f.get('url')) : project.siteUrl).href;
            const experiment = newExperiment(pageUrl, String(f.get('name')).trim() || 'Nova campanha', type, {
              splitUrl: type === 'split' ? new URL(splitUrl).href : undefined,
            });
            await saveExperiment({ experiment, projectId: project.id, editorUrl: pageUrl }, true);
            if (visual) go(experiment.id);
            else navigate('server', { id: experiment.id });
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
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Tipo de campanha"
        >
          {CAMPAIGN_ORDER.map((t) => {
            const c = CAMPAIGNS[t];
            const Icon = c.icon;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                aria-label={c.label}
                data-testid={`type-${t}`}
                className={`rounded-md border p-2.5 text-left ${type === t ? 'border-ink bg-lime-soft/60' : 'border-gray-900/10 hover:bg-gray-50'}`}
              >
                <Icon size={16} className={type === t ? 'text-ink' : 'text-gray-500'} aria-hidden="true" />
                <span className="mt-1.5 block text-[13px] font-medium text-ink">{c.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-600">{CAMPAIGNS[type].help}</p>
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
        {visual && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {type === 'split' ? 'Página original (controle)' : 'Página a editar'}
            </span>
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
        )}
        {visual && suggestions.length > 0 && (
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
        {type === 'split' && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Página da variação</span>
            <input
              type="url"
              required
              value={splitUrl}
              onChange={(e) => setSplitUrl(e.target.value)}
              placeholder={`${base}/nova-home/`}
              className={inputCls}
              data-testid="create-split-url"
            />
          </label>
        )}
        <p className="text-xs text-gray-500">
          {type === 'personalization'
            ? 'Começa com 90% vendo a experiência e 10% no grupo de controle (holdout), para medir o efeito.'
            : type === 'rollout'
              ? 'Começa liberado para 10% do tráfego; aumente em Configurações quando estiver seguro.'
              : type === 'mvt'
                ? 'Começa com uma seção (original + 1 opção). Adicione seções e opções no editor.'
                : 'Começa como rascunho com Controle e Variação 1 (50/50).'}
        </p>
      </form>
    </Modal>
  );
}

function RowActions({
  e,
  canEdit,
  onChanged,
  onSchedule,
}: {
  e: ExperimentSummary;
  canEdit: boolean;
  onChanged(): void;
  onSchedule(): void;
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
    <div className="relative inline-block" onClick={(ev) => ev.stopPropagation()}>
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
          {e.status !== 'archived' && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onSchedule();
              }}
            >
              Agendar…
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

/** Abre a campanha: editor visual, ou página própria no server-side. */
const open = (e: ExperimentSummary) => (e.type === 'server' ? navigate('server', { id: e.id }) : go(e.id));

export function TypeTag({ type }: { type: CampaignType }) {
  const c = CAMPAIGNS[type] ?? CAMPAIGNS.ab;
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-600" title={c.label}>
      <Icon size={13} aria-hidden="true" /> {c.short}
    </span>
  );
}

export function ExperimentList({ user, type }: { user: Me; type?: CampaignType }) {
  const toast = useToast();
  const [items, setItems] = useState<ExperimentSummary[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const canEdit = user.role !== 'viewer';
  // Grupo exclusivo de cada experimento (aviso na lista); falha ao carregar só esconde o aviso.
  const [groupOf, setGroupOf] = useState(new Map<string, { name: string; percent: number }>());
  // Agendamentos pendentes por experimento (o 1º é o próximo); falha só esconde o aviso.
  const [scheduled, setScheduled] = useState(new Map<string, Schedule[]>());
  const [scheduling, setScheduling] = useState<ExperimentSummary | null>(null);
  const load = useCallback(() => {
    listExperiments().then(setItems, (e: Error) => toast('error', `Não foi possível carregar: ${e.message}`));
    schedules.list().then(
      (ss) => {
        const m = new Map<string, Schedule[]>();
        for (const s of ss) m.set(s.experimentId, [...(m.get(s.experimentId) ?? []), s]);
        setScheduled(m);
      },
      () => {},
    );
    entities.list<Group>('group').then(
      (gs) =>
        setGroupOf(
          new Map(
            gs.flatMap((g) => g.data.experiments.map((e) => [e.id, { name: g.name, percent: e.percent }])),
          ),
        ),
      () => {},
    );
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = `${type ? CAMPAIGNS[type].label : 'Experimentos'} · Experimenta`;
  }, [type]);

  // Contagens e lista só do tipo desta tela (Server-side não conta os testes A/B).
  const ofType = useMemo(() => (items ?? []).filter((e) => !type || e.type === type), [items, type]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ofType.length };
    for (const e of ofType) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [ofType]);
  const shown = ofType.filter(
    (e) =>
      (filter === 'all' ? e.status !== 'archived' : e.status === filter) &&
      (!q || `${e.name} ${e.key} ${e.editorUrl}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        eyebrow={type ? 'Campanhas' : 'Testes'}
        title={type ? CAMPAIGNS[type].label : 'Experimentos'}
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

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-900/10 bg-white">
        <table className="w-full text-left text-sm" data-testid="experiment-list">
          <thead className="border-b border-gray-900/10 bg-gray-50">
            <tr className="label-mono">
              <th className="min-w-56 px-4 py-2.5 font-medium">Experimento</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Status</th>
              <th className="px-4 py-2.5 font-medium">Tipo</th>
              <th className="px-4 py-2.5 font-medium">Página</th>
              <th className="px-4 py-2.5 font-medium">Variações</th>
              <th className="px-4 py-2.5 font-medium">Tráfego</th>
              <th className="px-4 py-2.5 font-medium">Atualizado</th>
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
                onClick={() => open(e)}
                className="group cursor-pointer hover:bg-lime-soft/40"
                data-testid="experiment-row"
              >
                <td className="px-4 py-3">
                  <button
                    className="text-left font-medium text-ink decoration-lime decoration-2 underline-offset-4 group-hover:underline"
                    onClick={() => open(e)}
                  >
                    {e.name}
                  </button>
                  <div className="max-w-56 truncate font-mono text-[11px] text-gray-400" title={e.key}>
                    {e.key}
                  </div>
                  <div className="mt-1 sm:hidden">
                    <StatusBadge status={e.status} />
                  </div>
                  {(groupOf.get(e.id) || scheduled.get(e.id)) && (
                    <div className="mt-1 flex gap-1 whitespace-nowrap">
                      {groupOf.get(e.id) && (
                        <button
                          className="inline-flex items-center gap-1 rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200"
                          title={`Grupo exclusivo "${groupOf.get(e.id)!.name}": quem entra neste teste não entra nos outros do grupo. Fatia de ${groupOf.get(e.id)!.percent}% do tráfego.`}
                          aria-label={`Grupo ${groupOf.get(e.id)!.name} · ${groupOf.get(e.id)!.percent}%`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigate('groups');
                          }}
                          data-testid="row-group"
                        >
                          <Layers size={11} aria-hidden="true" /> {groupOf.get(e.id)!.percent}%
                        </button>
                      )}
                      {scheduled.get(e.id) && (
                        <button
                          className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100"
                          title={[
                            ...scheduled.get(e.id)!.map(scheduleLabel),
                            'Executa até 1 h depois do horário (verificação de hora em hora).',
                          ].join('\n')}
                          aria-label={scheduled.get(e.id)!.map(scheduleLabel).join('; ')}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setScheduling(e);
                          }}
                          data-testid="row-schedule"
                        >
                          <CalendarClock size={11} aria-hidden="true" />
                          {new Date(scheduled.get(e.id)![0]!.at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                          {scheduled.get(e.id)!.length > 1 && ` +${scheduled.get(e.id)!.length - 1}`}
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-4 py-3">
                  <TypeTag type={e.type as CampaignType} />
                </td>
                <td className="max-w-xs px-4 py-3">
                  <span className="block truncate font-mono text-xs text-gray-600" title={e.editorUrl}>
                    {e.editorUrl.replace(/^https?:\/\//, '')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <VariationChips count={e.variations} />
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-gray-600">
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-gray-100">
                      <span className="block h-full bg-brand-500" style={{ width: `${e.traffic}%` }} />
                    </span>
                    <span className="tabular font-mono text-xs">{e.traffic}%</span>
                  </span>
                </td>
                <td
                  className="px-4 py-3 whitespace-nowrap text-gray-500"
                  title={new Date(e.updatedAt).toLocaleString('pt-BR')}
                >
                  {timeAgo(e.updatedAt)}
                </td>
                <td className="px-2 py-3 text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Relatório"
                    title="Relatório"
                    data-testid="row-report"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      navigate('report', { id: e.id });
                    }}
                  >
                    <BarChart3 size={15} />
                  </Button>
                  <RowActions e={e} canEdit={canEdit} onChanged={load} onSchedule={() => setScheduling(e)} />
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
      <CreateModal open={creating} onClose={() => setCreating(false)} initialType={type} />
      {scheduling && (
        <ScheduleModal
          experimentId={scheduling.id}
          name={scheduling.name}
          canEdit={canEdit}
          onClose={() => setScheduling(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
