import type { Audience, AudienceRule } from '@abtest/shared';
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { entities, type Entity, type Me } from '../api';
import {
  Button,
  Card,
  EmptyState,
  inputCls,
  Modal,
  PageHeader,
  Segmented,
  selectCls,
  Spinner,
  useToast,
} from '../ui';

type RuleType = AudienceRule['type'];

/** Tipos de regra no construtor: rótulo e regra inicial. */
export const RULES: { type: RuleType; label: string; group: string; make(): AudienceRule }[] = [
  {
    type: 'pageviews',
    label: 'Páginas vistas',
    group: 'Comportamento',
    make: () => ({ type: 'pageviews', op: 'gte', value: 3 }),
  },
  {
    type: 'sessions',
    label: 'Visitas (sessões)',
    group: 'Comportamento',
    make: () => ({ type: 'sessions', op: 'gte', value: 2 }),
  },
  {
    type: 'event',
    label: 'Fez o evento',
    group: 'Comportamento',
    make: () => ({ type: 'event', name: '', op: 'gte', value: 1 }),
  },
  {
    type: 'visited',
    label: 'Visitou a página',
    group: 'Comportamento',
    make: () => ({ type: 'visited', value: '', negate: false }),
  },
  {
    type: 'visitor',
    label: 'Novo ou recorrente',
    group: 'Comportamento',
    make: () => ({ type: 'visitor', value: 'returning' }),
  },
  {
    type: 'utm',
    label: 'Campanha (UTM)',
    group: 'Origem',
    make: () => ({ type: 'utm', param: 'utm_source', op: 'eq', value: '' }),
  },
  {
    type: 'referrer',
    label: 'Site de origem',
    group: 'Origem',
    make: () => ({ type: 'referrer', op: 'contains', value: '' }),
  },
  {
    type: 'attribute',
    label: 'Atributo do visitante',
    group: 'Dados',
    make: () => ({ type: 'attribute', key: '', op: 'eq', value: '' }),
  },
  {
    type: 'cookie',
    label: 'Cookie',
    group: 'Dados',
    make: () => ({ type: 'cookie', name: '', op: 'exists', value: '' }),
  },
  {
    type: 'js',
    label: 'Variável JavaScript',
    group: 'Dados',
    make: () => ({ type: 'js', path: '', op: 'eq', value: '' }),
  },
  {
    type: 'score',
    label: 'Propensão a converter',
    group: 'Dados',
    make: () => ({ type: 'score', op: 'gte', value: 0.6 }),
  },
  {
    type: 'device',
    label: 'Dispositivo',
    group: 'Contexto',
    make: () => ({ type: 'device', value: 'mobile' }),
  },
  {
    type: 'language',
    label: 'Idioma do navegador',
    group: 'Contexto',
    make: () => ({ type: 'language', value: 'pt' }),
  },
  {
    type: 'time',
    label: 'Horário e dia',
    group: 'Contexto',
    make: () => ({ type: 'time', from: 8, to: 18, days: [1, 2, 3, 4, 5] }),
  },
];

const TEXT_OPS = [
  ['eq', 'é igual a'],
  ['neq', 'é diferente de'],
  ['contains', 'contém'],
  ['regex', 'casa com regex'],
  ['exists', 'existe'],
] as const;
const NUM_OPS = [
  ['gte', 'pelo menos'],
  ['lte', 'no máximo'],
  ['eq', 'exatamente'],
] as const;
const DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const cls = `${inputCls} py-1 text-[13px]`;
const sel = `${selectCls} py-1 text-[13px]`;

function Ops({
  value,
  ops,
  onChange,
}: {
  value: string;
  ops: readonly (readonly [string, string])[];
  onChange(v: string): void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={sel} aria-label="Operador">
      {ops.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** Campos de uma regra, conforme o tipo. */
function RuleFields({ r, onChange }: { r: AudienceRule; onChange(r: AudienceRule): void }) {
  const set = (p: object) => onChange({ ...r, ...p } as AudienceRule);
  const numInput = (v: number, step = 1) => (
    <input
      type="number"
      step={step}
      value={v}
      onChange={(e) => set({ value: Number(e.target.value) })}
      className={`${cls} w-24`}
      aria-label="Valor"
    />
  );
  const textInput = (v: string, ph = 'valor') => (
    <input
      value={v}
      onChange={(e) => set({ value: e.target.value })}
      placeholder={ph}
      className={cls}
      aria-label="Valor"
    />
  );
  switch (r.type) {
    case 'pageviews':
    case 'sessions':
    case 'score':
      return (
        <>
          <Ops value={r.op} ops={NUM_OPS} onChange={(op) => set({ op })} />
          {numInput(r.value, r.type === 'score' ? 0.05 : 1)}
        </>
      );
    case 'event':
      return (
        <>
          <input
            value={r.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="nome do evento"
            className={`${cls} font-mono`}
            aria-label="Evento"
          />
          <Ops value={r.op} ops={NUM_OPS} onChange={(op) => set({ op })} />
          {numInput(r.value)}
          <span className="text-xs text-gray-500">vezes</span>
        </>
      );
    case 'visited':
      return (
        <>
          <select
            value={r.negate ? 'no' : 'yes'}
            onChange={(e) => set({ negate: e.target.value === 'no' })}
            className={sel}
          >
            <option value="yes">já visitou</option>
            <option value="no">nunca visitou</option>
          </select>
          {textInput(r.value, '/checkout')}
        </>
      );
    case 'visitor':
      return (
        <select value={r.value} onChange={(e) => set({ value: e.target.value })} className={sel}>
          <option value="new">novo (1ª visita)</option>
          <option value="returning">recorrente</option>
        </select>
      );
    case 'device':
      return (
        <select value={r.value} onChange={(e) => set({ value: e.target.value })} className={sel}>
          <option value="desktop">Desktop</option>
          <option value="tablet">Tablet</option>
          <option value="mobile">Celular</option>
        </select>
      );
    case 'language':
      return textInput(r.value, 'pt, en-US…');
    case 'utm':
      return (
        <>
          <select
            value={r.param}
            onChange={(e) => set({ param: e.target.value })}
            className={`${sel} font-mono`}
          >
            {['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <Ops value={r.op} ops={TEXT_OPS} onChange={(op) => set({ op })} />
          {r.op !== 'exists' && textInput(r.value)}
        </>
      );
    case 'referrer':
      return (
        <>
          <Ops value={r.op} ops={TEXT_OPS} onChange={(op) => set({ op })} />
          {r.op !== 'exists' && textInput(r.value, 'google.')}
        </>
      );
    case 'attribute':
      return (
        <>
          <input
            value={r.key}
            onChange={(e) => set({ key: e.target.value })}
            placeholder="atributo"
            className={`${cls} font-mono`}
            aria-label="Atributo"
          />
          <Ops
            value={r.op}
            ops={[...TEXT_OPS.filter(([k]) => k !== 'regex'), ['gte', '≥'], ['lte', '≤']]}
            onChange={(op) => set({ op })}
          />
          {r.op !== 'exists' && textInput(r.value)}
        </>
      );
    case 'cookie':
      return (
        <>
          <input
            value={r.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="nome do cookie"
            className={`${cls} font-mono`}
            aria-label="Cookie"
          />
          <Ops value={r.op} ops={TEXT_OPS} onChange={(op) => set({ op })} />
          {r.op !== 'exists' && textInput(r.value)}
        </>
      );
    case 'js':
      return (
        <>
          <input
            value={r.path}
            onChange={(e) => set({ path: e.target.value })}
            placeholder="window.usuario.plano → usuario.plano"
            className={`${cls} font-mono`}
            aria-label="Variável"
          />
          <Ops value={r.op} ops={TEXT_OPS} onChange={(op) => set({ op })} />
          {r.op !== 'exists' && textInput(r.value)}
        </>
      );
    case 'time':
      return (
        <>
          <span className="text-xs text-gray-500">das</span>
          <input
            type="number"
            min={0}
            max={23}
            value={r.from}
            onChange={(e) => set({ from: Number(e.target.value) })}
            className={`${cls} w-16`}
            aria-label="De"
          />
          <span className="text-xs text-gray-500">às</span>
          <input
            type="number"
            min={1}
            max={24}
            value={r.to}
            onChange={(e) => set({ to: Number(e.target.value) })}
            className={`${cls} w-16`}
            aria-label="Até"
          />
          <span className="flex gap-0.5">
            {DAYS.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  set({ days: r.days.includes(i) ? r.days.filter((x) => x !== i) : [...r.days, i].sort() })
                }
                className={`h-6 w-6 rounded-sm font-mono text-[10px] ${r.days.includes(i) ? 'bg-ink text-lime' : 'bg-gray-100 text-gray-500'}`}
                aria-pressed={r.days.includes(i)}
              >
                {d}
              </button>
            ))}
          </span>
        </>
      );
  }
}

export function AudienceEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Audience> | null;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<AudienceRule[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setMatch(initial?.data.match ?? 'all');
    setRules(initial?.data.rules ?? [RULES[0]!.make()]);
  }, [open, initial]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await entities.save('audience', {
        id: initial?.id,
        name: name.trim() || 'Audiência',
        data: { match, rules },
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
      title={initial ? 'Editar audiência' : 'Nova audiência'}
      testId="audience-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="audience-save">
            Salvar audiência
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex.: Visitantes fiéis do celular)"
          className={inputCls}
          data-testid="audience-name"
        />
        <div className="flex items-center gap-2 text-sm text-gray-600">
          Visitantes que atendem
          <Segmented
            label="Combinação"
            value={match}
            onChange={setMatch}
            options={[
              ['all', 'todas'],
              ['any', 'qualquer uma'],
            ]}
          />
          das regras:
        </div>
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="rounded-md border border-gray-900/10 p-2.5" data-testid="audience-rule">
              <div className="flex items-center gap-2">
                <select
                  value={r.type}
                  onChange={(e) =>
                    setRules(
                      rules.map((x, j) =>
                        j === i ? RULES.find((d) => d.type === e.target.value)!.make() : x,
                      ),
                    )
                  }
                  className={`${sel} font-medium`}
                  aria-label="Tipo de regra"
                  data-testid="audience-rule-type"
                >
                  {['Comportamento', 'Origem', 'Dados', 'Contexto'].map((g) => (
                    <optgroup key={g} label={g}>
                      {RULES.filter((d) => d.group === g).map((d) => (
                        <option key={d.type} value={d.type}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="flex-1" />
                <button
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  disabled={rules.length === 1}
                  className="text-gray-400 hover:text-signal disabled:opacity-30"
                  aria-label="Remover regra"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RuleFields r={r} onChange={(nr) => setRules(rules.map((x, j) => (j === i ? nr : x)))} />
              </div>
            </li>
          ))}
        </ol>
        <Button
          size="sm"
          onClick={() => setRules([...rules, RULES[0]!.make()])}
          data-testid="audience-add-rule"
        >
          <Plus size={14} aria-hidden="true" /> Regra
        </Button>
        <p className="text-xs text-gray-500">
          Avaliado no navegador do visitante, sem atraso: comportamento vem do histórico local dele neste
          site.
        </p>
      </div>
    </Modal>
  );
}

/** Resumo legível de uma regra (lista e configurações). */
export function describeRule(r: AudienceRule): string {
  const op = (o: string) =>
    ({ gte: '≥', lte: '≤', eq: '=', neq: '≠', contains: 'contém', regex: '~', exists: 'existe' })[o] ?? o;
  switch (r.type) {
    case 'pageviews':
      return `páginas vistas ${op(r.op)} ${r.value}`;
    case 'sessions':
      return `visitas ${op(r.op)} ${r.value}`;
    case 'event':
      return `evento ${r.name} ${op(r.op)} ${r.value}`;
    case 'visited':
      return `${r.negate ? 'nunca visitou' : 'visitou'} ${r.value}`;
    case 'visitor':
      return r.value === 'new' ? 'visitante novo' : 'visitante recorrente';
    case 'device':
      return `dispositivo ${r.value}`;
    case 'language':
      return `idioma ${r.value}`;
    case 'utm':
      return `${r.param} ${op(r.op)} ${r.value}`;
    case 'referrer':
      return `origem ${op(r.op)} ${r.value}`;
    case 'attribute':
      return `${r.key} ${op(r.op)} ${r.value}`;
    case 'cookie':
      return `cookie ${r.name} ${op(r.op)} ${r.value}`;
    case 'js':
      return `${r.path} ${op(r.op)} ${r.value}`;
    case 'time':
      return `das ${r.from}h às ${r.to}h${r.days.length ? ` (${r.days.map((d) => DAYS[d]).join('')})` : ''}`;
    case 'score':
      return `propensão ${op(r.op)} ${r.value}`;
  }
}

export function AudiencesPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [list, setList] = useState<Entity<Audience>[] | null>(null);
  const [editing, setEditing] = useState<Entity<Audience> | null | 'new'>(null);
  const load = useCallback(
    () => entities.list<Audience>('audience').then(setList, (e: Error) => toast('error', e.message)),
    [toast],
  );
  useEffect(() => {
    document.title = 'Audiências — Experimenta';
    void load();
  }, [load]);
  return (
    <>
      <PageHeader
        eyebrow="Dados · Segmentação"
        title="Audiências"
        description="Grupos de visitantes reutilizáveis: por comportamento, origem, atributos, cookies, variáveis da página e contexto. Use na segmentação de qualquer campanha."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-audience">
              <Plus size={16} aria-hidden="true" /> Nova audiência
            </Button>
          )
        }
      />
      <div className="mt-6">
        {list === null ? (
          <div className="grid place-items-center py-24 text-gray-400">
            <Spinner />
          </div>
        ) : !list.length ? (
          <EmptyState icon={<Users size={20} aria-hidden="true" />} title="Nenhuma audiência ainda">
            Ex.: “voltou 3+ vezes e nunca comprou”, “veio da campanha black-friday”, “plano = pro”.
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="audiences">
            {list.map((a) => (
              <Card key={a.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{a.name}</p>
                    <p className="label-mono mt-0.5">
                      {a.data.match === 'all' ? 'todas as regras' : 'qualquer regra'}
                    </p>
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label="Editar">
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir"
                        onClick={async () => {
                          await entities.remove('audience', a.id);
                          void load();
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  )}
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {a.data.rules.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-sm bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-700"
                    >
                      {describeRule(r)}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
      <AudienceEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
      />
    </>
  );
}
