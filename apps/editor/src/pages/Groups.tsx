import { GROUP_SLOTS, type Group } from '@abtest/shared';
import { Layers, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  entities,
  listExperiments,
  publish,
  publishedText,
  type Entity,
  type ExperimentSummary,
  type Me,
} from '../api';
import { navigate } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  inputCls,
  LoadingBlock,
  Modal,
  PageHeader,
  selectCls,
  StatusBadge,
  useLoad,
  useToast,
} from '../ui';

const COLORS = ['bg-brand-500', 'bg-ink', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-400'];
const color = (i: number) => COLORS[i % COLORS.length]!;
const total = (g: Group['experiments']) => g.reduce((s, e) => s + e.percent, 0);

/** Barra empilhada: fatia de cada experimento no grupo + o que sobra livre. */
function AllocationBar({ items }: { items: { name: string; percent: number }[] }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
      {items.map((e, i) => (
        <span
          key={i}
          className={`${color(i)} h-full border-r border-white last:border-r-0`}
          style={{ width: `${e.percent}%` }}
          title={`${e.name}: ${e.percent}%`}
        />
      ))}
    </div>
  );
}

/** Avisos de um grupo: tráfego que não entra em nenhum teste, testes fora do ar ou excluídos. */
function groupWarnings(g: Group, byId: Map<string, ExperimentSummary>): string[] {
  const out: string[] = [];
  const free = GROUP_SLOTS - total(g.experiments);
  if (!g.experiments.length) out.push('Grupo vazio: adicione experimentos para dividir o tráfego.');
  else if (free > 0) out.push(`${free}% dos visitantes do grupo não entram em nenhum destes testes.`);
  const off = g.experiments.filter((e) => byId.get(e.id)?.status !== 'running');
  if (off.length)
    out.push(
      `${off.length === 1 ? 'Um teste não está' : `${off.length} testes não estão`} em execução: a fatia dele fica sem teste até iniciar ou sair do grupo.`,
    );
  return out;
}

function GroupEditor({
  open,
  initial,
  experiments,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Group> | null;
  experiments: ExperimentSummary[];
  groups: Entity<Group>[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [list, setList] = useState<Group['experiments']>([]);
  const [busy, setBusy] = useState(false);
  const byId = new Map(experiments.map((e) => [e.id, e]));
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.data.description ?? '');
    // Experimento excluído some do formulário (a API recusaria o id).
    setList((initial?.data.experiments ?? []).filter((e) => byId.has(e.id)));
  }, [open, initial]);
  const taken = new Set(
    groups.filter((g) => g.id !== initial?.id).flatMap((g) => g.data.experiments.map((e) => e.id)),
  );
  const available = experiments.filter(
    (e) => e.status !== 'archived' && !taken.has(e.id) && !list.some((x) => x.id === e.id),
  );
  const sum = total(list);
  /** Divide 100% igualmente (o resto vai para os primeiros). */
  const evenly = (l: Group['experiments']) => {
    const base = Math.floor(GROUP_SLOTS / l.length);
    return l.map((e, i) => ({ ...e, percent: base + (i < GROUP_SLOTS - base * l.length ? 1 : 0) }));
  };
  // Novo experimento fica com o que está livre; sem sobra, todos passam a dividir igualmente.
  const add = (id: string) => {
    if (!id) return;
    const free = GROUP_SLOTS - sum;
    setList(free > 0 ? [...list, { id, percent: free }] : evenly([...list, { id, percent: 1 }]));
  };
  const invalid = !name.trim() || sum > GROUP_SLOTS || list.some((e) => !(e.percent >= 1));
  const save = async () => {
    setBusy(true);
    try {
      await entities.save('group', {
        id: initial?.id,
        name: name.trim(),
        data: { description, experiments: list },
      });
      toast('success', publishedText(await publish(), 'Grupo salvo e publicado.'));
      onSaved();
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
      title={initial ? `Grupo ${initial.name}` : 'Novo grupo exclusivo'}
      testId="group-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={save} data-testid="group-save">
            Salvar e publicar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="label-mono mb-1 block">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Checkout"
            className={inputCls}
            data-testid="group-name"
          />
        </label>
        <label className="block">
          <span className="label-mono mb-1 block">Descrição</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Testes que mexem no mesmo funil"
            className={inputCls}
          />
        </label>
        <fieldset>
          <legend className="label-mono mb-1">Experimentos e fatia do tráfego do grupo</legend>
          {list.length > 0 && (
            <div className="mb-2">
              <AllocationBar
                items={list.map((e) => ({ name: byId.get(e.id)?.name ?? e.id, percent: e.percent }))}
              />
            </div>
          )}
          <ul className="space-y-1" data-testid="group-members">
            {list.map((e, i) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color(i)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{byId.get(e.id)?.name ?? e.id}</span>
                <input
                  type="number"
                  min={1}
                  max={GROUP_SLOTS}
                  value={Number.isFinite(e.percent) ? e.percent : ''}
                  onChange={(ev) =>
                    setList(
                      list.map((x, j) =>
                        j === i ? { ...x, percent: Math.round(ev.target.valueAsNumber) } : x,
                      ),
                    )
                  }
                  className={`${inputCls} w-20 py-1 text-right font-mono`}
                  aria-label={`Fatia de ${byId.get(e.id)?.name ?? e.id} (%)`}
                  data-testid="group-percent"
                />
                <span className="text-xs text-gray-500">%</span>
                <button
                  type="button"
                  onClick={() => setList(list.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-signal"
                  aria-label={`Tirar ${byId.get(e.id)?.name ?? e.id} do grupo`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value=""
              onChange={(e) => add(e.target.value)}
              className={`${selectCls} max-w-xs py-1`}
              aria-label="Adicionar experimento"
              data-testid="group-add"
              disabled={!available.length || list.length >= GROUP_SLOTS}
            >
              <option value="">
                {available.length ? '+ adicionar experimento…' : 'Nenhum experimento disponível'}
              </option>
              {available.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {list.length > 1 && (
              <button
                type="button"
                className="text-xs text-brand-700 hover:underline"
                onClick={() => setList(evenly(list))}
              >
                Dividir igualmente
              </button>
            )}
          </div>
          <p
            className={`mt-2 text-xs ${sum > GROUP_SLOTS ? 'text-signal' : 'text-gray-500'}`}
            data-testid="group-total"
          >
            {sum > GROUP_SLOTS
              ? `A soma passa de 100% (${sum}%).`
              : `${sum}% em uso · ${GROUP_SLOTS - sum}% dos visitantes do grupo não entram em nenhum.`}
          </p>
        </fieldset>
        <p className="text-xs text-gray-500">
          Cada visitante cai numa só fatia, sempre a mesma. Dentro da fatia valem a segmentação e o tráfego do
          próprio teste. Mudar as fatias só move os visitantes da diferença; um experimento fica em um grupo
          só.
        </p>
      </div>
    </Modal>
  );
}

export function GroupsPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [editing, setEditing] = useState<Entity<Group> | null | 'new'>(null);
  const [removing, setRemoving] = useState<Entity<Group> | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useLoad(() => Promise.all([entities.list<Group>('group'), listExperiments()]), []);
  useEffect(() => {
    document.title = 'Grupos exclusivos · Experimenta';
  }, []);
  const [groups, experiments] = data ?? [null, []];
  const byId = new Map(experiments.map((e) => [e.id, e]));
  const remove = async (g: Entity<Group>) => {
    setBusy(true);
    try {
      await entities.remove('group', g.id);
      toast(
        'success',
        publishedText(await publish(), 'Grupo excluído: os testes voltam a dividir o tráfego.'),
      );
      setRemoving(null);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Testes"
        title="Grupos exclusivos"
        description="Testes no mesmo grupo dividem o tráfego e cada visitante entra em no máximo um deles, para um teste não contaminar o resultado do outro (ex.: dois testes no mesmo checkout)."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-group">
              <Plus size={16} aria-hidden="true" /> Novo grupo
            </Button>
          )
        }
      />
      <div className="mt-6">
        {groups === null ? (
          <LoadingBlock rows={3} />
        ) : !groups.length ? (
          <EmptyState icon={<Layers size={20} aria-hidden="true" />} title="Nenhum grupo ainda">
            Ex.: “Checkout” com o teste do botão (50%) e o do frete (50%): quem vê um não vê o outro.
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="groups">
            {groups.map((g) => {
              const items = g.data.experiments.map((e) => ({
                ...e,
                exp: byId.get(e.id),
                name: byId.get(e.id)?.name ?? 'Experimento excluído',
              }));
              const warnings = groupWarnings(g.data, byId);
              return (
                <Card
                  key={g.id}
                  title={<span data-testid="group-title">{g.name}</span>}
                  action={
                    canEdit && (
                      <span className="flex">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(g)}
                          aria-label={`Editar ${g.name}`}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoving(g)}
                          aria-label={`Excluir ${g.name}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </span>
                    )
                  }
                >
                  <div data-testid="group-card">
                    {g.data.description && <p className="mb-3 text-sm text-gray-600">{g.data.description}</p>}
                    <AllocationBar items={items} />
                    <ul className="mt-3 divide-y divide-gray-900/[0.06] text-sm">
                      {items.map((e, i) => (
                        <li key={e.id} className="flex items-center gap-2 py-2">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${color(i)}`}
                            aria-hidden="true"
                          />
                          {e.exp ? (
                            <button
                              className="min-w-0 flex-1 truncate text-left text-ink hover:underline"
                              onClick={() => navigate('report', { id: e.id })}
                            >
                              {e.name}
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-gray-400">{e.name}</span>
                          )}
                          {e.exp && <StatusBadge status={e.exp.status} />}
                          <span
                            className="tabular w-24 text-right font-mono text-xs text-gray-600"
                            title={
                              e.exp
                                ? `${e.percent}% do grupo × ${e.exp.traffic}% de tráfego do teste`
                                : undefined
                            }
                          >
                            {e.percent}%
                            {e.exp && e.exp.traffic < 100 && (
                              <span className="block text-[10.5px] text-gray-400">
                                efetivo {Math.round(e.percent * e.exp.traffic) / 100}%
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {warnings.map((w) => (
                      <p
                        key={w}
                        className="mt-2 flex items-start gap-1.5 text-xs text-amber-700"
                        data-testid="group-warning"
                      >
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}
                      </p>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <GroupEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        experiments={experiments}
        groups={groups ?? []}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir grupo?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => removing && remove(removing)}
              data-testid="confirm-delete-group"
            >
              Excluir e publicar
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Os testes de <b>{removing?.name}</b> continuam rodando, mas deixam de ser exclusivos: um visitante
          pode cair em mais de um deles.
        </p>
      </Modal>
    </>
  );
}
