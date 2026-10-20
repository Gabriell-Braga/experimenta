import { FlagSchema, type Flag } from '@abtest/shared';
import { Flag as FlagIcon, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { API_URL, entities, publish, type Entity, type Me } from '../api';
import {
  Button,
  Card,
  EmptyState,
  inputCls,
  Modal,
  PageHeader,
  selectCls,
  Spinner,
  usePending,
  useToast,
} from '../ui';

const OPS: [Flag['rules'][number]['op'], string][] = [
  ['eq', '='],
  ['neq', '≠'],
  ['in', 'em (lista)'],
  ['contains', 'contém'],
  ['gte', '≥'],
  ['lte', '≤'],
];

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange(v: boolean): unknown;
  label: string;
}) {
  const pending = usePending();
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={pending.on || undefined}
      disabled={pending.on}
      onClick={() => pending.run(() => onChange(!on))}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-gray-300'}`}
      data-testid="flag-switch"
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

function FlagEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Flag> | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Flag>(FlagSchema.parse({ key: 'nova-flag' }));
  const [vars, setVars] = useState('{}');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const v = initial?.data ?? { ...FlagSchema.parse({ key: 'x', rollout: 10 }), key: '' };
    setF(v);
    setVars(JSON.stringify(v.variables, null, 2));
  }, [open, initial]);
  const save = async () => {
    let variables: Record<string, unknown>;
    try {
      variables = JSON.parse(vars || '{}') as Record<string, unknown>;
    } catch {
      return toast('error', 'Variáveis com JSON inválido.');
    }
    setBusy(true);
    try {
      await entities.save('flag', { id: initial?.id, name: f.key, data: { ...f, variables } });
      await publish();
      toast('success', 'Salva e publicada: o SDK recebe em até 1 min.');
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
      title={initial ? `Flag ${initial.data.key}` : 'Nova feature flag'}
      testId="flag-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="flag-save">
            Salvar e publicar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="label-mono mb-1 block">Chave (usada no código)</span>
          <input
            value={f.key}
            onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })}
            placeholder="novo-checkout"
            className={`${inputCls} font-mono`}
            data-testid="flag-key"
            disabled={!!initial}
          />
        </label>
        <label className="block">
          <span className="label-mono mb-1 block">Descrição</span>
          <input
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            className={inputCls}
          />
        </label>
        <div className="flex items-center gap-3">
          <Switch on={f.enabled} onChange={(enabled) => setF({ ...f, enabled })} label="Ligada" />
          <span>{f.enabled ? 'Ligada' : 'Desligada'}</span>
        </div>
        <label className="block">
          <span className="label-mono mb-1 block">Rollout: {f.rollout}% dos usuários</span>
          <input
            type="range"
            min={0}
            max={100}
            value={f.rollout}
            onChange={(e) => setF({ ...f, rollout: Number(e.target.value) })}
            className="w-full accent-[#12825f]"
            data-testid="flag-rollout"
          />
        </label>
        <fieldset>
          <legend className="label-mono mb-1">Regras de atributo (todas precisam bater)</legend>
          {f.rules.map((r, i) => (
            <div key={i} className="mb-1 flex items-center gap-1">
              <input
                value={r.attribute}
                onChange={(e) =>
                  setF({
                    ...f,
                    rules: f.rules.map((x, j) => (j === i ? { ...x, attribute: e.target.value } : x)),
                  })
                }
                placeholder="plano"
                className={`${inputCls} py-1 font-mono text-xs`}
              />
              <select
                value={r.op}
                onChange={(e) =>
                  setF({
                    ...f,
                    rules: f.rules.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof r.op } : x)),
                  })
                }
                className={`${selectCls} py-1`}
              >
                {OPS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                value={r.value}
                onChange={(e) =>
                  setF({
                    ...f,
                    rules: f.rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  })
                }
                placeholder="pro"
                className={`${inputCls} py-1 text-xs`}
              />
              <button
                onClick={() => setF({ ...f, rules: f.rules.filter((_, j) => j !== i) })}
                className="text-gray-400 hover:text-signal"
                aria-label="Remover regra"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-brand-700 hover:underline"
            onClick={() => setF({ ...f, rules: [...f.rules, { attribute: '', op: 'eq', value: '' }] })}
          >
            + regra
          </button>
        </fieldset>
        <label className="block">
          <span className="label-mono mb-1 block">Variáveis quando ativa (JSON)</span>
          <textarea
            value={vars}
            onChange={(e) => setVars(e.target.value)}
            rows={4}
            spellCheck={false}
            className={`${inputCls} font-mono text-xs`}
          />
        </label>
      </div>
    </Modal>
  );
}

export function FlagsPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [list, setList] = useState<Entity<Flag>[] | null>(null);
  const [editing, setEditing] = useState<Entity<Flag> | null | 'new'>(null);
  const load = useCallback(
    () => entities.list<Flag>('flag').then(setList, (e: Error) => toast('error', e.message)),
    [toast],
  );
  useEffect(() => {
    document.title = 'Feature flags · Experimenta';
    void load();
  }, [load]);
  const patch = async (e: Entity<Flag>, p: Partial<Flag>) => {
    try {
      await entities.save('flag', { id: e.id, name: e.name, data: { ...e.data, ...p } });
      await publish();
      void load();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const sdk = `import { createClient } from '@abtest/sdk';

const abt = await createClient({
  accountId: '${user.accountId}',
  cdnUrl: '${API_URL}/cdn',
});

if (abt.isEnabled('novo-checkout', usuario.id, { plano: usuario.plano })) {
  const { passos } = abt.getVariables('novo-checkout', usuario.id);
}
const v = abt.getVariation('checkout-rapido', usuario.id); // server-side
abt.track('compra', usuario.id, { value: 199.9 });`;
  return (
    <>
      <PageHeader
        eyebrow="Testes · Server-side"
        title="Feature flags"
        description="Ligue funcionalidades sem deploy, libere aos poucos (rollout) e só para quem você quiser. Avaliadas no seu backend pelo SDK, sem ida à rede por decisão."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-flag">
              <Plus size={16} aria-hidden="true" /> Nova flag
            </Button>
          )
        }
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          {list === null ? (
            <div className="grid place-items-center py-24 text-gray-400">
              <Spinner />
            </div>
          ) : !list.length ? (
            <EmptyState icon={<FlagIcon size={20} aria-hidden="true" />} title="Nenhuma flag ainda">
              Ex.: <code className="font-mono">novo-checkout</code> ligada para 10% e para o plano pro.
            </EmptyState>
          ) : (
            <ul
              className="divide-y divide-gray-900/[0.06] overflow-hidden rounded-lg border border-gray-900/10 bg-white"
              data-testid="flags"
            >
              {list.map((e) => (
                <li key={e.id} className="flex items-center gap-4 px-4 py-3" data-testid="flag-row">
                  <Switch
                    on={e.data.enabled}
                    onChange={(enabled) => canEdit && patch(e, { enabled })}
                    label={`Ligar ${e.data.key}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-medium text-ink">{e.data.key}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {e.data.description || 'Sem descrição'}
                      {e.data.rules.length
                        ? ` · ${e.data.rules.map((r) => `${r.attribute} ${r.op} ${r.value}`).join(' e ')}`
                        : ''}
                    </span>
                  </span>
                  <span className="flex w-36 items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-gray-100">
                      <span
                        className="block h-full rounded-full bg-brand-500"
                        style={{ width: `${e.data.rollout}%` }}
                      />
                    </span>
                    <span className="tabular w-10 text-right font-mono text-xs">{e.data.rollout}%</span>
                  </span>
                  {canEdit && (
                    <span className="flex">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Editar">
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir"
                        onClick={async () => {
                          await entities.remove('flag', e.id);
                          await publish().catch(() => {});
                          void load();
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title="SDK (Node, Deno, Workers, navegador)">
          <pre className="overflow-x-auto rounded-md bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-[#e8e4da]">
            {sdk}
          </pre>
          <p className="mt-2 text-xs text-gray-500">
            A config fica em cache no processo e é recarregada a cada minuto; a decisão é local (rollout
            determinístico por usuário).
          </p>
        </Card>
      </div>
      <FlagEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
      />
    </>
  );
}
