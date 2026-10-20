import { renderSurvey, SCALES } from '@abtest/engage';
import { SurveySchema, type Question, type Survey } from '@abtest/shared';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  MessageSquareText,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { entities, publish, query, type Entity, type Me } from '../api';
import { BarList, SERIES } from '../charts';
import { EngageFields } from '../components/EngageFields';
import { navigate } from '../nav';
import { uid } from '../store';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  Modal,
  PageHeader,
  LoadingBlock,
  selectCls,
  Stat,
  StatusBadge,
  useLoad,
  useToast,
} from '../ui';
import type { EngageStats } from './Popups';

const TYPES: [Question['type'], string][] = [
  ['nps', 'NPS (0 a 10)'],
  ['csat', 'Satisfação (CSAT 1 a 5)'],
  ['ces', 'Esforço (CES 1 a 7)'],
  ['rating', 'Nota (1 a 5)'],
  ['choice', 'Escolha única'],
  ['multi', 'Múltipla escolha'],
  ['text', 'Texto livre'],
];
const label = (t: Question['type']) => TYPES.find((x) => x[0] === t)![1];
const newQ = (type: Question['type'] = 'nps'): Question => ({
  id: uid('q'),
  type,
  text: type === 'nps' ? 'De 0 a 10, quanto você recomendaria nossa loja a um amigo?' : 'Sua pergunta',
  options: type === 'choice' || type === 'multi' ? ['Opção 1', 'Opção 2'] : [],
  required: type !== 'text',
  logic: [],
});

function Preview({ s }: { s: Survey }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = renderSurvey(document, s, { onDone: () => {} });
    el.append(w.host);
    return () => w.remove();
  }, [s]);
  return (
    <div
      ref={box}
      className="grid-paper relative h-96 rounded-md border border-gray-900/10"
      style={{ transform: 'translateZ(0)' }}
      data-testid="survey-preview"
    />
  );
}

function QuestionEditor({
  q,
  all,
  onChange,
  onRemove,
  onMove,
}: {
  q: Question;
  all: Question[];
  onChange(q: Question): void;
  onRemove(): void;
  onMove(d: -1 | 1): void;
}) {
  const i = all.indexOf(q);
  const scale = SCALES[q.type];
  const rule = q.logic[0];
  return (
    <li className="rounded-md border border-gray-900/10 p-2.5" data-testid="survey-question">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-ink font-mono text-[11px] text-lime">
          {i + 1}
        </span>
        <select
          value={q.type}
          onChange={(e) => onChange({ ...newQ(e.target.value as Question['type']), id: q.id, text: q.text })}
          className={`${selectCls} py-1 text-[13px]`}
          aria-label="Tipo"
        >
          {TYPES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={q.required}
            onChange={(e) => onChange({ ...q, required: e.target.checked })}
          />{' '}
          obrigatória
        </label>
        <span className="flex-1" />
        <button
          onClick={() => onMove(-1)}
          disabled={i === 0}
          className="text-gray-400 hover:text-ink disabled:opacity-30"
          aria-label="Subir"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={i === all.length - 1}
          className="text-gray-400 hover:text-ink disabled:opacity-30"
          aria-label="Descer"
        >
          <ArrowDown size={14} />
        </button>
        <button
          onClick={onRemove}
          disabled={all.length === 1}
          className="text-gray-400 hover:text-signal disabled:opacity-30"
          aria-label="Remover pergunta"
        >
          <X size={15} />
        </button>
      </div>
      <input
        value={q.text}
        onChange={(e) => onChange({ ...q, text: e.target.value })}
        className={`${inputCls} mt-2 py-1.5 text-[13px]`}
        aria-label="Pergunta"
        data-testid="survey-question-text"
      />
      {(q.type === 'choice' || q.type === 'multi') && (
        <textarea
          value={q.options.join('\n')}
          onChange={(e) =>
            onChange({
              ...q,
              options: e.target.value
                .split('\n')
                .map((o) => o.trim())
                .filter(Boolean)
                .slice(0, 12),
            })
          }
          rows={3}
          className={`${inputCls} mt-2 text-[13px]`}
          aria-label="Opções (uma por linha)"
          placeholder="Uma opção por linha"
        />
      )}
      {(scale || q.type === 'choice') && i < all.length - 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
          Lógica: se a resposta
          <select
            value={rule ? rule.op : ''}
            onChange={(e) =>
              onChange({
                ...q,
                logic: e.target.value
                  ? [
                      {
                        op: e.target.value as 'eq',
                        value: rule?.value ?? (scale ? scale.values.at(-2)! : (q.options[0] ?? '')),
                        goto: rule?.goto ?? 'end',
                      },
                    ]
                  : [],
              })
            }
            className={`${selectCls} py-0.5 text-xs`}
          >
            <option value="">Sem lógica</option>
            <option value="eq">for</option>
            {scale && <option value="gte">for ≥</option>}
            {scale && <option value="lte">for ≤</option>}
          </select>
          {rule && (
            <>
              {scale ? (
                <input
                  type="number"
                  value={rule.value}
                  onChange={(e) => onChange({ ...q, logic: [{ ...rule, value: Number(e.target.value) }] })}
                  className={`${inputCls} w-16 py-0.5 text-xs`}
                />
              ) : (
                <select
                  value={String(rule.value)}
                  onChange={(e) => onChange({ ...q, logic: [{ ...rule, value: e.target.value }] })}
                  className={`${selectCls} py-0.5 text-xs`}
                >
                  {q.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
              ir para
              <select
                value={rule.goto}
                onChange={(e) => onChange({ ...q, logic: [{ ...rule, goto: e.target.value }] })}
                className={`${selectCls} py-0.5 text-xs`}
              >
                {all.slice(i + 2).map((x) => (
                  <option key={x.id} value={x.id}>
                    pergunta {all.indexOf(x) + 1}
                  </option>
                ))}
                <option value="end">fim (agradecimento)</option>
              </select>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function SurveyEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Survey> | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [s, setS] = useState<Survey>(SurveySchema.parse({ questions: [newQ()] }));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setS(
      initial?.data ??
        SurveySchema.parse({
          trigger: { type: 'scroll', percent: 60 },
          questions: [newQ('nps'), { ...newQ('text'), text: 'O que podemos melhorar?' }],
        }),
    );
  }, [open, initial]);
  const save = async (andPublish: boolean) => {
    setBusy(true);
    try {
      await entities.save('survey', {
        id: initial?.id,
        name: name.trim() || 'Pesquisa',
        data: andPublish ? { ...s, status: 'running' } : s,
      });
      if (andPublish) await publish();
      toast('success', andPublish ? 'Publicada: aparece no site em até 1 min.' : 'Salva.');
      onSaved();
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const qs = s.questions;
  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={initial ? 'Editar pesquisa' : 'Nova pesquisa'}
      testId="survey-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => save(false)}>
            Salvar
          </Button>
          <Button variant="accent" loading={busy} onClick={() => save(true)} data-testid="survey-publish">
            Salvar e publicar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome interno (ex.: NPS pós-compra)"
            className={inputCls}
            data-testid="survey-name"
          />
          <ol className="space-y-2">
            {qs.map((q) => (
              <QuestionEditor
                key={q.id}
                q={q}
                all={qs}
                onChange={(nq) => setS({ ...s, questions: qs.map((x) => (x.id === q.id ? nq : x)) })}
                onRemove={() => setS({ ...s, questions: qs.filter((x) => x.id !== q.id) })}
                onMove={(d) => {
                  const i = qs.indexOf(q);
                  const n = [...qs];
                  [n[i], n[i + d]] = [n[i + d]!, n[i]!];
                  setS({ ...s, questions: n });
                }}
              />
            ))}
          </ol>
          <Button
            size="sm"
            onClick={() => setS({ ...s, questions: [...qs, newQ('csat')] })}
            disabled={qs.length >= 15}
            data-testid="survey-add-question"
          >
            <Plus size={14} aria-hidden="true" /> Pergunta
          </Button>
          <label className="block text-sm">
            <span className="label-mono mb-1 block">Mensagem final</span>
            <input
              value={s.thankYou}
              onChange={(e) => setS({ ...s, thankYou: e.target.value })}
              className={inputCls}
            />
          </label>
          <div className="flex items-end gap-3">
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Formato</span>
              <select
                value={s.format}
                onChange={(e) => setS({ ...s, format: e.target.value as Survey['format'] })}
                className={selectCls}
              >
                <option value="slide-in">Canto da tela</option>
                <option value="modal">Janela central</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Cor</span>
              <input
                type="color"
                value={s.accent}
                onChange={(e) => setS({ ...s, accent: e.target.value })}
                className="h-9 w-14 rounded border border-gray-300"
              />
            </label>
          </div>
          <EngageFields<Survey> value={s} onChange={setS} />
        </div>
        <div className="space-y-2">
          <p className="label-mono">Pré-visualização (interativa)</p>
          <Preview s={s} />
        </div>
      </div>
    </Modal>
  );
}

export function SurveysPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [editing, setEditing] = useState<Entity<Survey> | null | 'new'>(null);
  const { data: list, reload: reloadList } = useLoad(() => entities.list<Survey>('survey'), []);
  const { data: statsList, reload: reloadStats } = useLoad(
    () => query<EngageStats[]>('/analytics/engage', { days: 30 }).catch(() => []),
    [],
  );
  const stats = Object.fromEntries((statsList ?? []).map((s) => [s.campaignId, s]));
  const load = () => {
    reloadList();
    reloadStats();
  };
  useEffect(() => {
    document.title = 'Pesquisas · Experimenta';
  }, []);
  const toggle = async (e: Entity<Survey>) => {
    try {
      await entities.save('survey', {
        id: e.id,
        name: e.name,
        data: { ...e.data, status: e.data.status === 'running' ? 'paused' : 'running' },
      });
      await publish();
      toast('success', e.data.status === 'running' ? 'Pausada e retirada do site.' : 'No ar em até 1 min.');
      load();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Engajamento · Feedback"
        title="Pesquisas"
        description="Pergunte direto ao visitante, no momento certo: NPS, satisfação (CSAT), esforço (CES), escolhas e texto livre, com lógica entre perguntas."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-survey">
              <Plus size={16} aria-hidden="true" /> Nova pesquisa
            </Button>
          )
        }
      />
      <div className="mt-6">
        {list === null || statsList === null ? (
          <LoadingBlock rows={4} />
        ) : !list.length ? (
          <EmptyState
            icon={<MessageSquareText size={20} aria-hidden="true" />}
            title="Nenhuma pesquisa ainda"
          >
            Um NPS no fim do checkout e um “o que faltou?” na intenção de saída já rendem muitas ideias de
            teste.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-900/10 bg-white">
            <table className="w-full text-left text-sm" data-testid="surveys">
              <thead className="border-b border-gray-900/10 bg-gray-50">
                <tr className="label-mono">
                  <th className="px-4 py-2.5 font-medium">Pesquisa</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Exibições</th>
                  <th className="px-4 py-2.5 text-right font-medium">Respostas</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900/[0.06]">
                {list.map((e) => {
                  const st = stats[e.id];
                  return (
                    <tr key={e.id} data-testid="survey-row">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate('survey', { id: e.id })}
                          className="text-left font-medium text-ink hover:underline"
                        >
                          {e.name}
                        </button>
                        <span className="block font-mono text-[11px] text-gray-400">
                          {e.data.questions.length} pergunta{e.data.questions.length > 1 ? 's' : ''} ·{' '}
                          {e.data.questions.map((q) => q.type).join(', ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.data.status} />
                      </td>
                      <td className="tabular px-4 py-3 text-right font-mono text-xs">
                        {fmt.int(st?.views ?? 0)}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-mono text-xs">
                        {fmt.int(st?.submits ?? 0)}
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate('survey', { id: e.id })}
                          aria-label="Respostas"
                        >
                          <BarChart3 size={14} />
                        </Button>
                        {canEdit && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggle(e)}
                              aria-label={e.data.status === 'running' ? 'Pausar' : 'Ativar'}
                            >
                              {e.data.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(e)}
                              aria-label="Editar"
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Excluir"
                              onClick={async () => {
                                await entities.remove('survey', e.id);
                                await publish().catch(() => {});
                                load();
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SurveyEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </>
  );
}

interface QReport {
  id: string;
  type: Question['type'];
  text: string;
  answers: number;
  score?: number | null;
  average?: number | null;
  promoters?: number;
  passives?: number;
  detractors?: number;
  distribution?: Record<string, number>;
  options?: { option: string; count: number }[];
  recent?: string[];
  words?: { word: string; count: number }[];
}
interface SurveyReport {
  id: string;
  name: string;
  views: number;
  responses: number;
  completed: number;
  responseRate: number;
  questions: QReport[];
}

/** Barras verticais da distribuição de notas (0 a 10, 1 a 5…). */
function Distribution({ q }: { q: QReport }) {
  const values = SCALES[q.type]!.values;
  const max = Math.max(1, ...values.map((v) => q.distribution?.[v] ?? 0));
  const color = (v: number) =>
    q.type === 'nps' ? (v >= 9 ? SERIES[0] : v <= 6 ? SERIES[2] : '#cfc8ba') : SERIES[1];
  return (
    <div className="flex h-28 items-end gap-1" role="img" aria-label="Distribuição das notas">
      {values.map((v) => {
        const n = q.distribution?.[v] ?? 0;
        return (
          <div key={v} className="flex flex-1 flex-col items-center gap-1" title={`${v}: ${n}`}>
            <span className="tabular font-mono text-[10px] text-gray-500">{n || ''}</span>
            <div
              className="w-full max-w-6 rounded-t-[4px]"
              style={{ height: `${(n / max) * 80}px`, background: color(v) }}
            />
            <span className="font-mono text-[10px] text-gray-500">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SurveyReportPage({ id }: { id: string }) {
  const { data: r } = useLoad(
    () => query<SurveyReport>(`/analytics/survey/${encodeURIComponent(id)}`, { days: 90 }),
    [id],
  );
  if (!r) return <LoadingBlock stats={4} rows={6} />;
  return (
    <>
      <button
        onClick={() => navigate('surveys')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Pesquisas
      </button>
      <PageHeader eyebrow="Pesquisa · últimos 90 dias" title={r.name} />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Exibições" value={fmt.int(r.views)} />
        <Stat label="Respostas" value={fmt.int(r.responses)} />
        <Stat label="Taxa de resposta" value={fmt.pct(r.responseRate, 0)} />
        <Stat label="Concluídas" value={fmt.int(r.completed)} />
      </div>
      <div className="mt-5 space-y-5" data-testid="survey-report">
        {r.questions.map((q, i) => (
          <Card
            key={q.id}
            title={`${i + 1}. ${q.text}`}
            action={
              <span className="label-mono">
                {label(q.type)} · {fmt.int(q.answers)} respostas
              </span>
            }
          >
            {q.type === 'nps' && (
              <div className="grid items-center gap-5 md:grid-cols-[200px_1fr]">
                <div>
                  <p className="label-mono">NPS</p>
                  <p
                    className={`tabular text-5xl font-semibold ${q.score === null || q.score === undefined ? 'text-gray-300' : q.score >= 0 ? 'text-brand-600' : 'text-signal'}`}
                    data-testid="nps-score"
                  >
                    {q.score ?? 'n/d'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">
                    {q.promoters} promotores · {q.passives} neutros · {q.detractors} detratores
                  </p>
                </div>
                <Distribution q={q} />
              </div>
            )}
            {q.type === 'csat' && (
              <div className="grid items-center gap-5 md:grid-cols-[200px_1fr]">
                <div>
                  <p className="label-mono">Satisfeitos (4 a 5)</p>
                  <p className="tabular text-5xl font-semibold text-ink">
                    {q.score === null || q.score === undefined ? 'n/d' : fmt.pct(q.score, 0)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">
                    média {q.average?.toFixed(1) ?? 'n/d'}
                  </p>
                </div>
                <Distribution q={q} />
              </div>
            )}
            {(q.type === 'ces' || q.type === 'rating') && (
              <div className="grid items-center gap-5 md:grid-cols-[200px_1fr]">
                <div>
                  <p className="label-mono">Média</p>
                  <p className="tabular text-5xl font-semibold text-ink">{q.average?.toFixed(1) ?? 'n/d'}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">
                    {q.type === 'ces' ? '1 = muito difícil · 7 = muito fácil' : 'de 1 a 5'}
                  </p>
                </div>
                <Distribution q={q} />
              </div>
            )}
            {(q.type === 'choice' || q.type === 'multi') && (
              <BarList
                items={(q.options ?? []).map((o) => ({
                  key: o.option,
                  label: o.option,
                  value: o.count,
                  hint: q.answers ? fmt.pct(o.count / q.answers, 0) : undefined,
                }))}
              />
            )}
            {q.type === 'text' && (
              <div className="grid gap-5 md:grid-cols-[1fr_220px]">
                <ul className="space-y-2 text-sm text-gray-700">
                  {(q.recent ?? []).map((t, j) => (
                    <li key={j} className="rounded-md bg-gray-50 px-3 py-2">
                      “{t}”
                    </li>
                  ))}
                  {!q.recent?.length && <li className="text-gray-400">Sem respostas ainda.</li>}
                </ul>
                <div>
                  <p className="label-mono mb-2">Palavras frequentes</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {(q.words ?? []).map((w) => (
                      <li
                        key={w.word}
                        className="rounded-sm bg-lime-soft px-1.5 py-0.5 font-mono text-ink"
                        style={{ fontSize: `${Math.min(18, 11 + w.count * 1.5)}px` }}
                      >
                        {w.word}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
