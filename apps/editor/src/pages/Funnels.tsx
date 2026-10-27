import type { Funnel, FunnelStep } from '@abtest/shared';
import { ArrowDown, Filter, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { entities, query, type Entity, type Me } from '../api';
import { SERIES } from '../charts';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  Modal,
  PageHeader,
  LoadingBlock,
  Segmented,
  selectCls,
  Skeleton,
  useLoad,
  useToast,
} from '../ui';
import { PERIODS, type Period } from './Events';

interface StepRow {
  name: string;
  visitors: number;
  fromPrevious: number;
  fromStart: number;
  dropoff: number;
  medianMsFromPrevious: number | null;
  dropoffNext: { page: string; count: number }[];
}
interface FunnelReport {
  id: string;
  name: string;
  visitors: number;
  completed: number;
  conversion: number;
  steps: StepRow[];
  /** Eventos vistos no período (custom e do GTM). */
  eventNames?: string[];
}

const path = (u: string) => (u.startsWith('(') ? u : u.replace(/^https?:\/\/[^/]+/, '') || '/');
const dur = (ms: number | null) =>
  ms === null
    ? 'n/d'
    : ms < 60_000
      ? `${Math.round(ms / 1000)} s`
      : ms < 3_600_000
        ? `${Math.round(ms / 60_000)} min`
        : `${(ms / 3_600_000).toFixed(1)} h`;

const emptyStep = (i: number): FunnelStep => ({
  type: 'url',
  name: `Passo ${i + 1}`,
  url: { match: 'contains', value: '', exclude: false },
});

/** Construtor de funil: passos por página (regra de URL) ou evento customizado, em ordem. */
export function FunnelEditor({
  open,
  initial,
  onClose,
  onSaved,
  eventNames = [],
}: {
  open: boolean;
  initial: Entity<Funnel> | null;
  onClose(): void;
  onSaved(id: string): void;
  /** Sugestões para passos de evento (inclui os eventos do GTM capturados do dataLayer). */
  eventNames?: string[];
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setWindowDays(initial?.data.windowDays ?? 7);
    setSteps(initial?.data.steps ?? [emptyStep(0), emptyStep(1)]);
  }, [open, initial]);
  const patch = (i: number, s: FunnelStep) => setSteps(steps.map((x, j) => (j === i ? s : x)));
  const save = async () => {
    if (steps.some((s) => (s.type === 'url' ? !s.url.value.trim() : !s.event.trim())))
      return toast('error', 'Preencha a página ou o evento de todos os passos.');
    setBusy(true);
    try {
      const r = await entities.save('funnel', {
        id: initial?.id,
        name: name.trim() || 'Funil',
        data: { steps, windowDays },
      });
      onSaved(r.id);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar funil' : 'Novo funil'}
      testId="funnel-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="funnel-save">
            Salvar funil
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Compra"
            className={inputCls}
            data-testid="funnel-name"
          />
        </label>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="rounded-md border border-gray-900/10 p-2.5" data-testid="funnel-step">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-ink font-mono text-[11px] text-lime">
                  {i + 1}
                </span>
                <input
                  value={s.name}
                  onChange={(e) => patch(i, { ...s, name: e.target.value })}
                  className={`${inputCls} py-1`}
                  aria-label="Nome do passo"
                />
                <button
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  disabled={steps.length <= 2}
                  className="text-gray-400 hover:text-signal disabled:opacity-30"
                  aria-label="Remover passo"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <select
                  className={selectCls}
                  value={s.type === 'url' ? s.url.match : 'event'}
                  onChange={(e) =>
                    patch(
                      i,
                      e.target.value === 'event'
                        ? { type: 'event', name: s.name, event: s.type === 'event' ? s.event : '' }
                        : {
                            type: 'url',
                            name: s.name,
                            url: {
                              match: e.target.value as 'exact',
                              value: s.type === 'url' ? s.url.value : '',
                              exclude: false,
                            },
                          },
                    )
                  }
                  aria-label="Tipo do passo"
                >
                  <option value="contains">URL contém</option>
                  <option value="exact">URL exata</option>
                  <option value="regex">URL (regex)</option>
                  <option value="event">Evento (custom ou GTM)</option>
                </select>
                <input
                  value={s.type === 'url' ? s.url.value : s.event}
                  onChange={(e) =>
                    patch(
                      i,
                      s.type === 'url'
                        ? { ...s, url: { ...s.url, value: e.target.value } }
                        : { ...s, event: e.target.value },
                    )
                  }
                  placeholder={s.type === 'url' ? '/checkout' : 'nome do evento (abq track ou dataLayer)'}
                  list={s.type === 'event' ? 'funnel-event-names' : undefined}
                  className={`${inputCls} py-1 font-mono text-xs`}
                  aria-label="Valor do passo"
                  data-testid="funnel-step-value"
                />
              </div>
            </li>
          ))}
        </ol>
        <datalist id="funnel-event-names">
          {eventNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            onClick={() => setSteps([...steps, emptyStep(steps.length)])}
            disabled={steps.length >= 12}
            data-testid="funnel-add-step"
          >
            <Plus size={14} aria-hidden="true" /> Passo
          </Button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Completar em até
            <input
              type="number"
              min={1}
              max={90}
              value={windowDays}
              onChange={(e) => setWindowDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
              className={`${inputCls} w-16 py-1`}
            />
            dias
          </label>
        </div>
      </div>
    </Modal>
  );
}

export function FunnelsPage({ user }: { user: Me }) {
  const canEdit = user.role !== 'viewer';
  const [sel, setSel] = useState<string | null>(null);
  const [days, setDays] = useState<Period>('30');
  const [device, setDevice] = useState('');
  const [eventName, setEventName] = useState('');
  const [editing, setEditing] = useState<Entity<Funnel> | null | 'new'>(null);
  const { data: list, reload } = useLoad(() => entities.list<Funnel>('funnel'), []);
  useEffect(() => {
    document.title = 'Funis · Experimenta';
  }, []);
  useEffect(() => {
    if (list) setSel((s) => s ?? list[0]?.id ?? null);
  }, [list]);
  const { data: report, reload: reloadReport } = useLoad(
    () =>
      sel
        ? query<FunnelReport>(`/analytics/funnel/${encodeURIComponent(sel)}`, {
            days,
            device: device || undefined,
            event: eventName || undefined,
          })
        : null,
    [sel, days, device, eventName],
  );
  const current = list?.find((f) => f.id === sel) ?? null;
  const max = Math.max(1, report?.steps[0]?.visitors ?? 1);

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Funis"
        description="O caminho até a conversão, passo a passo: quantos avançam, quanto tempo levam e para onde vão os que desistem."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-funnel">
              <Plus size={16} aria-hidden="true" /> Novo funil
            </Button>
          )
        }
      />
      {list === null ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
          <LoadingBlock stats={3} rows={4} />
        </div>
      ) : !list.length ? (
        <div className="mt-6">
          <EmptyState
            icon={<Filter size={20} aria-hidden="true" />}
            title="Nenhum funil ainda"
            action={
              canEdit && (
                <Button variant="primary" onClick={() => setEditing('new')}>
                  Criar funil
                </Button>
              )
            }
          >
            Defina os passos (páginas ou eventos) e veja onde os visitantes desistem. Funciona sobre os dados
            já coletados.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1.5">
            <p className="label-mono mb-2">Funis</p>
            {list.map((f) => (
              <button
                key={f.id}
                onClick={() => setSel(f.id)}
                className={`block w-full rounded-md border px-3 py-2.5 text-left ${sel === f.id ? 'border-ink bg-white' : 'border-gray-900/10 bg-white/50 hover:bg-white'}`}
                data-testid="funnel-item"
              >
                <span className="block truncate text-sm font-medium text-ink">{f.name}</span>
                <span className="font-mono text-[11px] text-gray-500">{f.data.steps.length} passos</span>
              </button>
            ))}
          </aside>
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className={selectCls}
                aria-label="Dispositivo"
              >
                <option value="">Todos os dispositivos</option>
                <option value="desktop">Desktop</option>
                <option value="tablet">Tablet</option>
                <option value="mobile">Celular</option>
              </select>
              <select
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className={selectCls}
                aria-label="Fez o evento"
                data-testid="funnel-event-filter"
              >
                <option value="">Qualquer evento</option>
                {[...new Set([...(report?.eventNames ?? []), ...(eventName ? [eventName] : [])])].map((n) => (
                  <option key={n} value={n}>
                    Fez {n}
                  </option>
                ))}
              </select>
              <div className="flex-1" />
              {canEdit && current && (
                <>
                  <Button size="sm" onClick={() => setEditing(current)}>
                    <Pencil size={13} aria-hidden="true" /> Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Excluir funil"
                    onClick={async () => {
                      await entities.remove('funnel', current.id);
                      setSel(null);
                      reload();
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
            {!report ? (
              sel && <LoadingBlock stats={3} rows={4} />
            ) : (
              <Card title={report.name}>
                <div className="mb-5 flex flex-wrap gap-6">
                  <div>
                    <p className="label-mono">Entraram</p>
                    <p className="tabular text-2xl font-semibold text-ink">{fmt.int(report.visitors)}</p>
                  </div>
                  <div>
                    <p className="label-mono">Concluíram</p>
                    <p className="tabular text-2xl font-semibold text-ink">{fmt.int(report.completed)}</p>
                  </div>
                  <div>
                    <p className="label-mono">Conversão do funil</p>
                    <p
                      className="tabular text-2xl font-semibold text-brand-600"
                      data-testid="funnel-conversion"
                    >
                      {fmt.pct(report.conversion, 1)}
                    </p>
                  </div>
                </div>
                <ol className="space-y-1" data-testid="funnel-steps">
                  {report.steps.map((s, i) => (
                    <li key={i}>
                      {i > 0 && (
                        <div className="flex items-center gap-2 py-1 pl-2 font-mono text-[11px] text-gray-500">
                          <ArrowDown size={13} aria-hidden="true" />
                          <b className="text-ink">{fmt.pct(s.fromPrevious, 1)}</b> avançaram · mediana{' '}
                          {dur(s.medianMsFromPrevious)}
                        </div>
                      )}
                      <div className="grid grid-cols-[minmax(120px,200px)_1fr_auto] items-center gap-3">
                        <span className="flex items-center gap-2 text-sm text-ink">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-ink font-mono text-[10px] text-lime">
                            {i + 1}
                          </span>
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className="h-7 rounded-[4px] bg-gray-50">
                          <span
                            className="block h-full rounded-[4px]"
                            style={{ width: `${(s.visitors / max) * 100}%`, background: SERIES[0] }}
                          />
                        </span>
                        <span className="tabular w-24 text-right font-mono text-xs">
                          {fmt.int(s.visitors)}{' '}
                          <span className="text-gray-400">{fmt.pct(s.fromStart, 0)}</span>
                        </span>
                      </div>
                      {s.dropoff > 0 && (
                        <details className="mt-1 ml-7 text-xs text-gray-600">
                          <summary className="font-mono text-[11px] text-signal">
                            {fmt.int(s.dropoff)} desistiram aqui: para onde foram
                          </summary>
                          <ul className="mt-1 space-y-0.5 pl-3">
                            {s.dropoffNext.map((d) => (
                              <li key={d.page} className="flex justify-between gap-3 font-mono text-[11px]">
                                <span className="truncate">{path(d.page)}</span>
                                <span>{d.count}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </div>
        </div>
      )}
      <FunnelEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        eventNames={report?.eventNames}
        onSaved={(id) => {
          if (id === sel) reloadReport();
          setSel(id);
          reload();
        }}
      />
    </>
  );
}
