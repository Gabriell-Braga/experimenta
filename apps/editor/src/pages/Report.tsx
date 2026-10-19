import { ArrowLeft, Download, Pencil, Printer, TriangleAlert, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  getExperiment,
  getReport,
  type ArmRow,
  type ArmStats,
  type ExperimentRecord,
  type ExperimentReport,
  type GoalReport,
  type Verdict,
} from '../api';
import { LineChart, seriesColor } from '../charts';
import { go, navigate, setParams } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  PageHeader,
  Segmented,
  selectCls,
  Spinner,
  StatusBadge,
  useToast,
} from '../ui';
import { shortDay } from './Events';

const PERIODS = [
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['90', '90 dias'],
  ['365', '1 ano'],
] as const;

const VERDICT: Record<Verdict, [string, string]> = {
  winner: ['Vencedora', 'bg-lime text-ink'],
  loser: ['Perdendo', 'bg-signal/10 text-signal'],
  leading: ['Liderando', 'bg-brand-50 text-brand-700'],
  inconclusive: ['Inconclusivo', 'bg-gray-100 text-gray-600'],
  baseline: ['Base', 'bg-gray-100 text-gray-500'],
};

function VerdictTag({ v }: { v: Verdict }) {
  const [label, cls] = VERDICT[v];
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase ${cls}`}
    >
      {label}
    </span>
  );
}

export function VariationTag({ index, name }: { index: number; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(index) }} />
      <span className="min-w-0 truncate font-medium text-ink">{name}</span>
    </span>
  );
}

/** Probabilidade sem prometer certeza absoluta (Monte Carlo nunca dá 100% de verdade). */
const prob = (p: number) => (p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : fmt.pct(p, 0));

const signedPct = (n: number | null, d = 1) => (n === null ? '—' : `${n > 0 ? '+' : ''}${fmt.pct(n, d)}`);

/** Faixa do intervalo de 95% (todas as linhas na mesma escala), com o ponto estimado. */
function IntervalStrip({
  low,
  high,
  point,
  min,
  max,
  color,
}: {
  low: number;
  high: number;
  point: number;
  min: number;
  max: number;
  color: string;
}) {
  const span = max - min || 1;
  const pos = (x: number) => `${((x - min) / span) * 100}%`;
  return (
    <span className="relative block h-4 w-full min-w-24" aria-hidden="true">
      <span className="absolute top-1/2 h-px w-full bg-gray-200" />
      <span
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-35"
        style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})`, background: color }}
      />
      <span
        className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: pos(point), background: color }}
      />
    </span>
  );
}

function Probability({ p }: { p: number | null }) {
  if (p === null) return <span className="text-gray-400">—</span>;
  const tone = p >= 0.95 ? 'bg-brand-500' : p <= 0.05 ? 'bg-signal' : 'bg-gray-400';
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100">
        <span className={`block h-full ${tone}`} style={{ width: `${p * 100}%` }} />
      </span>
      <b className="tabular font-mono text-xs font-semibold text-ink">{prob(p)}</b>
    </span>
  );
}

function GoalTable({ goal, names }: { goal: GoalReport; names: string[] }) {
  const lows = goal.arms.map((a) => a.rateLow);
  const highs = goal.arms.map((a) => a.rateHigh);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="report-table">
        <thead>
          <tr className="label-mono border-b border-gray-900/10">
            <th className="py-2 pr-3 font-medium">Variação</th>
            <th className="px-3 py-2 text-right font-medium">Visitantes</th>
            <th className="px-3 py-2 text-right font-medium">Conversões</th>
            <th className="px-3 py-2 text-right font-medium">Taxa</th>
            <th className="w-40 px-3 py-2 font-medium">Intervalo 95%</th>
            <th className="px-3 py-2 text-right font-medium">Melhoria</th>
            <th className="px-3 py-2 font-medium">Chance de vencer</th>
            <th className="px-3 py-2 text-right font-medium" title="z-test bicaudal vs controle">
              p-valor
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900/[0.06]">
          {goal.arms.map((a: ArmRow, i) => (
            <tr key={a.variationId} data-testid="report-row">
              <td className="py-2.5 pr-3">
                <span className="flex items-center gap-2">
                  <VariationTag index={i} name={names[i] ?? a.variationId} />
                  <VerdictTag v={a.verdict} />
                </span>
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs">{fmt.int(a.visitors)}</td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs">{fmt.int(a.conversions)}</td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs font-semibold text-ink">
                {fmt.pct(a.rate, 2)}
              </td>
              <td className="px-3 py-2.5" title={`${fmt.pct(a.rateLow, 2)} a ${fmt.pct(a.rateHigh, 2)}`}>
                <IntervalStrip
                  low={a.rateLow}
                  high={a.rateHigh}
                  point={a.rate}
                  min={min}
                  max={max}
                  color={seriesColor(i)}
                />
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs">
                <span
                  className={
                    a.lift === null ? 'text-gray-400' : a.lift > 0 ? 'text-brand-700' : 'text-signal'
                  }
                >
                  {signedPct(a.lift)}
                </span>
                {a.liftLow !== null && (
                  <span className="block text-[10px] text-gray-400">
                    {signedPct(a.liftLow, 0)} a {signedPct(a.liftHigh, 0)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <Probability p={a.probBeatControl} />
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs text-gray-500">
                {a.pValue === null
                  ? '—'
                  : a.pValue < 0.001
                    ? '<0,001'
                    : a.pValue.toFixed(3).replace('.', ',')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** MVT: efeito de cada opção, seção por seção (somando as combinações que a contêm). */
function SectionsCard({ goal }: { goal: GoalReport }) {
  return (
    <Card title="Efeito por seção (multivariado)">
      <div className="space-y-5" data-testid="mvt-sections">
        {goal.sections!.map((sec) => (
          <div key={sec.sectionId}>
            <p className="label-mono mb-2">{sec.name}</p>
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-gray-900/[0.06]">
                {sec.options.map((o, i) => (
                  <tr key={o.optionId}>
                    <td className="py-2 pr-3">
                      <VariationTag index={i} name={o.name} />
                    </td>
                    <td className="tabular px-3 py-2 text-right font-mono text-xs">{fmt.int(o.visitors)}</td>
                    <td className="tabular px-3 py-2 text-right font-mono text-xs font-semibold text-ink">
                      {fmt.pct(o.rate, 2)}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-mono text-xs">{signedPct(o.lift)}</td>
                    <td className="w-44 px-3 py-2">
                      <Probability p={o.probBeatControl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RevenueTable({ goal, names }: { goal: GoalReport; names: string[] }) {
  const stats = goal.revenueArms ?? [];
  return (
    <table className="w-full text-left text-sm" data-testid="revenue-table">
      <thead>
        <tr className="label-mono border-b border-gray-900/10">
          <th className="py-2 pr-3 font-medium">Variação</th>
          <th className="px-3 py-2 text-right font-medium">Receita</th>
          <th className="px-3 py-2 text-right font-medium">Por visitante</th>
          <th className="px-3 py-2 text-right font-medium">Melhoria</th>
          <th className="px-3 py-2 font-medium">Chance de vencer</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-900/[0.06]">
        {goal.arms.map((a, i) => {
          const s: ArmStats | undefined = stats[i];
          return (
            <tr key={a.variationId}>
              <td className="py-2.5 pr-3">
                <VariationTag index={i} name={names[i] ?? a.variationId} />
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs">{fmt.money(a.revenue)}</td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs font-semibold text-ink">
                {fmt.money(a.rpv)}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-xs">
                {signedPct(s?.lift ?? null)}
              </td>
              <td className="px-3 py-2.5">
                <Probability p={s?.probBeatControl ?? null} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Frase-resumo da meta primária: a manchete do relatório. */
function Headline({
  goal,
  names,
  visitors,
}: {
  goal: GoalReport | undefined;
  names: string[];
  visitors: number;
}) {
  if (!goal)
    return (
      <p className="text-gray-600">
        Adicione uma meta nas Configurações do experimento para medir conversões.
      </p>
    );
  // Rollout: uma variação só, sem controle para comparar.
  if (goal.arms.length === 1)
    return (
      <p data-testid="headline">
        {fmt.int(visitors)} visitantes receberam a mudança; {fmt.pct(goal.arms[0]!.rate, 2)} converteram em{' '}
        <i>{goal.goalKey}</i>.
      </p>
    );
  const best = goal.arms
    .map((a, i) => ({ a, i }))
    .slice(1)
    .sort((x, y) => (y.a.probBeatControl ?? 0) - (x.a.probBeatControl ?? 0))[0];
  if (!visitors || !best)
    return (
      <p className="text-gray-600">
        Ainda sem visitantes no período — publique o experimento e aguarde o tráfego.
      </p>
    );
  const { a, i } = best;
  const name = names[i]!;
  const chance = prob(a.probBeatControl ?? 0);
  if (a.verdict === 'winner')
    return (
      <p data-testid="headline">
        <span className="highlight">{name}</span> venceu: {chance} de chance de superar o controle, com{' '}
        <b>{signedPct(a.lift)}</b> em <i>{goal.goalKey}</i>.
      </p>
    );
  if (a.verdict === 'loser')
    return (
      <p data-testid="headline">
        Nenhuma variação supera o controle. <b>{name}</b> tem só {chance} de chance de vencer.
      </p>
    );
  return (
    <p data-testid="headline">
      {a.verdict === 'leading' ? (
        <>
          <b>{name}</b> está na frente ({chance} de chance, {signedPct(a.lift)}), mas ainda sem certeza.
        </>
      ) : (
        <>
          Ainda inconclusivo: {name} tem {chance} de chance de superar o controle.
        </>
      )}{' '}
      Continue rodando.
    </p>
  );
}

function toCsv(r: ExperimentReport, names: string[]): string {
  const rows = [
    [
      'meta',
      'variacao',
      'visitantes',
      'conversoes',
      'taxa',
      'melhoria',
      'chance_de_vencer',
      'p_valor',
      'receita',
    ],
  ];
  for (const g of r.goals)
    g.arms.forEach((a, i) =>
      rows.push([
        g.goalKey,
        names[i] ?? a.variationId,
        String(a.visitors),
        String(a.conversions),
        a.rate.toFixed(5),
        a.lift === null ? '' : a.lift.toFixed(5),
        a.probBeatControl === null ? '' : a.probBeatControl.toFixed(4),
        a.pValue === null ? '' : a.pValue.toFixed(5),
        a.revenue.toFixed(2),
      ]),
    );
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function ReportPage({ id, params }: { id: string; params: URLSearchParams }) {
  const toast = useToast();
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number][0]>((params.get('days') as '30') ?? '30');
  const [device, setDevice] = useState(params.get('device') ?? '');
  const [goalId, setGoalId] = useState<string | null>(params.get('goal'));
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    getExperiment(id).then(setRecord, (e: Error) => toast('error', e.message));
  }, [id, toast]);
  useEffect(() => {
    setParams({ days, device: device || undefined });
    getReport(id, { days: Number(days), device: device || undefined }).then(setReport, (e: Error) =>
      toast('error', e.message),
    );
  }, [id, days, device, toast]);
  useEffect(() => {
    document.title = `Relatório: ${record?.experiment.name ?? ''} — Experimenta`;
  }, [record]);

  const names = useMemo(() => report?.variations.map((v) => v.name) ?? [], [report]);
  const goal = report?.goals.find((g) => g.goalId === goalId) ?? report?.goals[0];
  const primary = report?.goals[0];

  if (!record || !report)
    return (
      <div className="grid place-items-center py-24 text-gray-500">
        <Spinner />
      </div>
    );
  const exp = record.experiment;
  return (
    <>
      <button
        onClick={() => navigate('tests')}
        className="no-print mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Experimentos
      </button>
      <PageHeader
        eyebrow={`Relatório · ${exp.key}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {exp.name} <StatusBadge status={exp.status} />
          </span>
        }
        actions={
          <span className="no-print flex gap-2">
            <Button onClick={() => go(exp.id)}>
              <Pencil size={14} aria-hidden="true" /> Editar
            </Button>
            <Button
              onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([toCsv(report, names)], { type: 'text/csv' }));
                a.download = `${exp.key}-relatorio.csv`;
                a.click();
              }}
              data-testid="report-csv"
            >
              <Download size={14} aria-hidden="true" /> CSV
            </Button>
            <Button onClick={() => print()}>
              <Printer size={14} aria-hidden="true" /> Imprimir
            </Button>
          </span>
        }
      />

      <div className="no-print mt-5 flex flex-wrap items-center gap-3">
        <Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />
        <select
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          className={selectCls}
          aria-label="Dispositivo"
          data-testid="report-device"
        >
          <option value="">Todos os dispositivos</option>
          <option value="desktop">Desktop</option>
          <option value="tablet">Tablet</option>
          <option value="mobile">Celular</option>
        </select>
      </div>

      <div className="mt-5 space-y-5">
        {report.srm.mismatch && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-gray-800"
            data-testid="srm-alert"
          >
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-signal" aria-hidden="true" />
            <span>
              <b>Divisão de tráfego fora do esperado</b> (SRM, p = {report.srm.pValue.toExponential(1)}). A
              proporção de visitantes por variação não bate com os pesos configurados — algo na atribuição ou
              na coleta está distorcendo o teste. Revise redirecionamentos, cache e o snippet antes de confiar
              no resultado.
            </span>
          </div>
        )}

        <section className="rounded-lg border border-gray-900/10 bg-white p-5">
          <div className="flex flex-wrap items-start gap-5">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-ink text-lime">
              <Trophy size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 font-display text-[22px] leading-snug text-ink">
              <Headline goal={primary} names={names} visitors={report.visitors} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-900/[0.07] pt-4 sm:grid-cols-4">
            <div>
              <dt className="label-mono">Visitantes</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-ink">{fmt.int(report.visitors)}</dd>
            </div>
            <div>
              <dt className="label-mono">Conversões (primária)</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-ink">
                {fmt.int(primary?.arms.reduce((s, a) => s + a.conversions, 0) ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="label-mono">Amostra p/ +{fmt.pct(report.estimate.mde, 0)}</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-ink">
                {report.estimate.neededPerVariation ? fmt.int(report.estimate.neededPerVariation) : '—'}
                <span className="ml-1 text-xs font-normal text-gray-500">por variação</span>
              </dd>
            </div>
            <div>
              <dt className="label-mono">Duração restante</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-ink">
                {primary?.arms.some((a) => a.verdict === 'winner' || a.verdict === 'loser')
                  ? 'pronto para decidir'
                  : report.estimate.daysRemaining === null
                    ? '—'
                    : report.estimate.daysRemaining === 0
                      ? 'amostra atingida'
                      : `~${report.estimate.daysRemaining} dias`}
              </dd>
            </div>
          </dl>
        </section>

        {!report.goals.length ? (
          <EmptyState
            icon={<Trophy size={20} aria-hidden="true" />}
            title="Sem metas"
            action={<Button onClick={() => go(exp.id)}>Abrir editor</Button>}
          >
            Defina o que conta como conversão (clique, página, formulário ou evento) em Configurações.
          </EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
            <aside className="no-print space-y-1.5">
              <p className="label-mono mb-2">Metas</p>
              {report.goals.map((g) => {
                const best = Math.max(...g.arms.slice(1).map((a) => a.lift ?? -Infinity));
                return (
                  <button
                    key={g.goalId}
                    onClick={() => {
                      setCompare(false);
                      setGoalId(g.goalId);
                      setParams({ goal: g.goalId });
                    }}
                    className={`block w-full rounded-md border px-3 py-2.5 text-left ${!compare && goal?.goalId === g.goalId ? 'border-ink bg-white' : 'border-gray-900/10 bg-white/50 hover:bg-white'}`}
                    data-testid="report-goal"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{g.goalKey}</span>
                      {g.primary && (
                        <span className="font-mono text-[10px] text-brand-600 uppercase">primária</span>
                      )}
                    </span>
                    <span className="tabular font-mono text-[11px] text-gray-500">
                      melhor: {Number.isFinite(best) ? signedPct(best) : '—'}
                      {g.hasRevenue && ' · receita'}
                    </span>
                  </button>
                );
              })}
              {report.goals.length > 1 && (
                <Button
                  size="sm"
                  variant={compare ? 'primary' : 'ghost'}
                  className="mt-2 w-full"
                  onClick={() => setCompare(!compare)}
                  data-testid="compare-goals"
                >
                  Comparar metas
                </Button>
              )}
            </aside>

            <div className="min-w-0 space-y-5">
              {compare ? (
                <Card title="Comparação de metas">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm" data-testid="compare-table">
                      <thead>
                        <tr className="label-mono border-b border-gray-900/10">
                          <th className="py-2 pr-3 font-medium">Meta</th>
                          {names.map((n, i) => (
                            <th key={n + i} className="px-3 py-2 font-medium">
                              <VariationTag index={i} name={n} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-900/[0.06]">
                        {report.goals.map((g) => (
                          <tr key={g.goalId}>
                            <td className="py-2.5 pr-3 font-medium text-ink">{g.goalKey}</td>
                            {g.arms.map((a) => (
                              <td key={a.variationId} className="tabular px-3 py-2.5 font-mono text-xs">
                                {fmt.pct(a.rate, 2)}
                                {a.lift !== null && (
                                  <span className={`ml-1.5 ${a.lift > 0 ? 'text-brand-700' : 'text-signal'}`}>
                                    {signedPct(a.lift)}
                                  </span>
                                )}
                                {a.probBeatControl !== null && (
                                  <span className="block text-[10px] text-gray-400">
                                    {prob(a.probBeatControl)} chance
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : (
                goal && (
                  <>
                    <Card title={`Conversão · ${goal.goalKey}`}>
                      <GoalTable goal={goal} names={names} />
                    </Card>
                    {goal.sections && <SectionsCard goal={goal} />}
                    {goal.hasRevenue && (
                      <Card title="Receita">
                        <RevenueTable goal={goal} names={names} />
                      </Card>
                    )}
                    {goal.primary && (
                      <Card title="Taxa de conversão acumulada (meta primária)">
                        <LineChart
                          integer={false}
                          format={(n) => fmt.pct(n, 1)}
                          labels={(report.series[0]?.points ?? []).map((p) => shortDay(p.day))}
                          series={report.series.map((s, i) => ({
                            name: names[i] ?? s.variationId,
                            color: seriesColor(i),
                            values: s.points.map((p) => p.rate),
                          }))}
                        />
                      </Card>
                    )}
                  </>
                )
              )}
              <p className="text-xs text-gray-500">
                Estatística bayesiana: “chance de vencer” é a probabilidade de a variação ter taxa maior que o
                controle, dado o que foi observado. Vencedora a partir de 95% com pelo menos 100 visitantes
                por variação. p-valor (z-test) ao lado para referência.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
