import type { Segment, SegmentRule } from '@abtest/shared';
import { Boxes, Download, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { API_URL, downloadFile, entities, query, type Entity, type Me } from '../api';
import { navigate } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  Modal,
  PageHeader,
  Segmented,
  selectCls,
  Spinner,
  timeAgo,
  useToast,
} from '../ui';

const FIELDS: [SegmentRule['field'], string][] = [
  ['sessions', 'Visitas'],
  ['pageviews', 'Páginas vistas'],
  ['conversions', 'Conversões'],
  ['revenue', 'Receita (R$)'],
  ['event', 'Fez o evento'],
  ['devices', 'Nº de dispositivos'],
  ['lastSeenDays', 'Dias desde a última visita'],
  ['firstSeenDays', 'Dias desde a 1ª visita'],
  ['attribute', 'Atributo'],
  ['identified', 'Identificado (logado)'],
  ['device', 'Usou o dispositivo'],
  ['experiment', 'Participou do experimento'],
];
const make = (f: SegmentRule['field']): SegmentRule =>
  f === 'event'
    ? { field: f, name: '', op: 'gte', value: 1 }
    : f === 'attribute'
      ? { field: f, key: '', op: 'eq', value: '' }
      : f === 'identified'
        ? { field: f, value: true }
        : f === 'device'
          ? { field: f, value: 'mobile' }
          : f === 'experiment'
            ? { field: f, key: '', variation: '' }
            : { field: f, op: 'gte', value: 1 };
const sm = `${inputCls} py-1 text-[13px]`;
const ss = `${selectCls} py-1 text-[13px]`;

function RuleRow({ r, onChange }: { r: SegmentRule; onChange(r: SegmentRule): void }) {
  const set = (p: object) => onChange({ ...r, ...p } as SegmentRule);
  const numOps = (op: string) => (
    <select value={op} onChange={(e) => set({ op: e.target.value })} className={ss} aria-label="Operador">
      <option value="gte">≥</option>
      <option value="lte">≤</option>
      <option value="eq">=</option>
    </select>
  );
  if (r.field === 'identified')
    return (
      <select
        value={String(r.value)}
        onChange={(e) => set({ value: e.target.value === 'true' })}
        className={ss}
      >
        <option value="true">sim</option>
        <option value="false">não</option>
      </select>
    );
  if (r.field === 'device')
    return (
      <select value={r.value} onChange={(e) => set({ value: e.target.value })} className={ss}>
        <option value="desktop">Desktop</option>
        <option value="tablet">Tablet</option>
        <option value="mobile">Celular</option>
      </select>
    );
  if (r.field === 'experiment')
    return (
      <>
        <input
          value={r.key}
          onChange={(e) => set({ key: e.target.value })}
          placeholder="chave do experimento"
          className={`${sm} font-mono`}
        />
        <input
          value={r.variation}
          onChange={(e) => set({ variation: e.target.value })}
          placeholder="variação (opcional)"
          className={`${sm} font-mono`}
        />
      </>
    );
  if (r.field === 'attribute')
    return (
      <>
        <input
          value={r.key}
          onChange={(e) => set({ key: e.target.value })}
          placeholder="atributo"
          className={`${sm} font-mono`}
        />
        <select value={r.op} onChange={(e) => set({ op: e.target.value })} className={ss}>
          <option value="eq">=</option>
          <option value="neq">≠</option>
          <option value="contains">contém</option>
          <option value="exists">existe</option>
        </select>
        {r.op !== 'exists' && (
          <input value={r.value} onChange={(e) => set({ value: e.target.value })} className={sm} />
        )}
      </>
    );
  return (
    <>
      {r.field === 'event' && (
        <input
          value={r.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="nome do evento"
          className={`${sm} font-mono`}
        />
      )}
      {numOps(r.op)}
      <input
        type="number"
        value={r.value}
        onChange={(e) => set({ value: Number(e.target.value) })}
        className={`${sm} w-24`}
        aria-label="Valor"
      />
    </>
  );
}

function SegmentEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Segment> | null;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<SegmentRule[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setMatch(initial?.data.match ?? 'all');
    setRules(initial?.data.rules ?? [make('conversions')]);
  }, [open, initial]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar segmento' : 'Novo segmento do CDP'}
      testId="segment-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            data-testid="segment-save"
            onClick={async () => {
              try {
                const r = await entities.save('segment', {
                  id: initial?.id,
                  name: name.trim() || 'Segmento',
                  data: { match, rules },
                });
                onSaved(r.id);
                onClose();
              } catch (e) {
                toast('error', (e as Error).message);
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Compradores inativos há 30 dias"
          className={inputCls}
          data-testid="segment-name"
        />
        <div className="flex items-center gap-2 text-sm text-gray-600">
          Perfis que atendem
          <Segmented
            label="Combinação"
            value={match}
            onChange={setMatch}
            options={[
              ['all', 'todas'],
              ['any', 'qualquer uma'],
            ]}
          />
        </div>
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-md border border-gray-900/10 p-2"
            >
              <select
                value={r.field}
                onChange={(e) =>
                  setRules(rules.map((x, j) => (j === i ? make(e.target.value as SegmentRule['field']) : x)))
                }
                className={`${ss} font-medium`}
                aria-label="Campo"
              >
                {FIELDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <RuleRow r={r} onChange={(nr) => setRules(rules.map((x, j) => (j === i ? nr : x)))} />
              <span className="flex-1" />
              <button
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
                disabled={rules.length === 1}
                className="text-gray-400 hover:text-signal disabled:opacity-30"
                aria-label="Remover regra"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ol>
        <Button size="sm" onClick={() => setRules([...rules, make('sessions')])}>
          <Plus size={14} aria-hidden="true" /> Regra
        </Button>
        <p className="text-xs text-gray-500">
          Avaliado no servidor sobre o perfil unificado (todos os dispositivos do usuário).
        </p>
      </div>
    </Modal>
  );
}

interface Members {
  id: string;
  name: string;
  count: number;
  profiles: {
    id: string;
    userId?: string;
    visitors: string[];
    sessions: number;
    revenue: number;
    lastSeen: number;
  }[];
}

export function SegmentsPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [list, setList] = useState<Entity<Segment>[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [members, setMembers] = useState<Members | null>(null);
  const [editing, setEditing] = useState<Entity<Segment> | null | 'new'>(null);
  const load = useCallback(
    (select?: string) =>
      entities.list<Segment>('segment').then(
        (l) => {
          setList(l);
          setSel((s) => select ?? s ?? l[0]?.id ?? null);
        },
        (e: Error) => toast('error', e.message),
      ),
    [toast],
  );
  useEffect(() => {
    document.title = 'Segmentos · Experimenta';
    void load();
  }, [load]);
  useEffect(() => {
    setMembers(null);
    if (sel)
      query<Members>(`/profiles/segments/${encodeURIComponent(sel)}`).then(setMembers, (e: Error) =>
        toast('error', e.message),
      );
  }, [sel, toast]);
  const current = list?.find((s) => s.id === sel);
  return (
    <>
      <PageHeader
        eyebrow="Dados · CDP"
        title="Segmentos"
        description="Grupos de perfis com regras sobre todo o histórico (todos os dispositivos). Exporte para CRM e mídia, ou consulte em tempo real pela API de decisão."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-segment">
              <Plus size={16} aria-hidden="true" /> Novo segmento
            </Button>
          )
        }
      />
      {list === null ? (
        <div className="grid place-items-center py-24 text-gray-400">
          <Spinner />
        </div>
      ) : !list.length ? (
        <div className="mt-6">
          <EmptyState icon={<Boxes size={20} aria-hidden="true" />} title="Nenhum segmento ainda">
            Ex.: “compraram e não voltam há 30 dias”, “plano pro que usa celular e desktop”.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1.5">
            {list.map((s) => (
              <button
                key={s.id}
                onClick={() => setSel(s.id)}
                className={`block w-full rounded-md border px-3 py-2.5 text-left ${sel === s.id ? 'border-ink bg-white' : 'border-gray-900/10 bg-white/50 hover:bg-white'}`}
                data-testid="segment-item"
              >
                <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                <span className="font-mono text-[11px] text-gray-500">{s.data.rules.length} regras</span>
              </button>
            ))}
          </aside>
          <div className="min-w-0 space-y-5">
            {current && (
              <Card
                title={
                  <span className="flex items-center gap-3">
                    {current.name}
                    <span
                      className="tabular font-mono text-xs font-normal text-gray-500"
                      data-testid="segment-count"
                    >
                      {members ? `${fmt.int(members.count)} perfis` : '…'}
                    </span>
                  </span>
                }
                action={
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        downloadFile(
                          `/profiles/segments/${encodeURIComponent(current.id)}?format=csv`,
                          `segmento-${current.id}.csv`,
                        )
                      }
                    >
                      <Download size={13} aria-hidden="true" /> CSV
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(current)}
                          aria-label="Editar"
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Excluir"
                          onClick={async () => {
                            await entities.remove('segment', current.id);
                            setSel(null);
                            void load();
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </>
                    )}
                  </span>
                }
                pad={false}
              >
                {!members ? (
                  <div className="grid place-items-center py-10 text-gray-400">
                    <Spinner />
                  </div>
                ) : (
                  <ul className="max-h-[420px] divide-y divide-gray-900/[0.05] overflow-y-auto">
                    {members.profiles.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={() => navigate('profile', { id: p.id })}
                          className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-ink">
                            {p.userId ?? `Anônimo ${p.visitors[0]!.slice(0, 8)}`}
                          </span>
                          <span className="tabular font-mono text-[11px] text-gray-500">
                            {p.sessions} visitas
                          </span>
                          <span className="tabular w-24 text-right font-mono text-[11px] text-gray-500">
                            {p.revenue ? fmt.money(p.revenue) : 'n/d'}
                          </span>
                          <span className="w-20 text-right text-xs text-gray-400">
                            {timeAgo(new Date(p.lastSeen).toISOString())}
                          </span>
                        </button>
                      </li>
                    ))}
                    {!members.profiles.length && (
                      <li className="px-4 py-6 text-center text-sm text-gray-400">
                        Nenhum perfil atende às regras.
                      </li>
                    )}
                  </ul>
                )}
              </Card>
            )}
            <Card title="API de decisão (cross-channel)">
              <p className="text-sm text-gray-600">
                Personalize e-mail, app e atendimento com a mesma inteligência do site: segmentos do perfil,
                variação das campanhas server-side e próxima melhor oferta.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-[#e8e4da]">{`GET ${API_URL}/decide?user=<id-do-cliente>
Authorization: Bearer <chave de API>

{ "segments": [{ "id": "…", "name": "…" }],
  "experiments": [{ "key": "…", "variation": "b", "variables": {…} }],
  "recommendations": [{ "id": "…", "name": "…", "price": … }] }`}</pre>
            </Card>
          </div>
        </div>
      )}
      <SegmentEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(id) => void load(id)}
      />
    </>
  );
}
