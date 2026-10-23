import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FlaskConical,
  Lightbulb,
  OctagonAlert,
  Trophy,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { MAX_USEFUL_DAYS } from '@abtest/shared';
import { getAttribution, getDashboardBlock, type Insight } from '../api';
import { AttributionTable } from '../components/Attribution';
import { LineChart, SERIES } from '../charts';
import { navigate } from '../nav';
import {
  Card,
  EmptyState,
  fmt,
  LoadingBlock,
  PageHeader,
  Segmented,
  selectCls,
  Skeleton,
  Stat,
  useLoad,
} from '../ui';
import { PERIODS, shortDay, type Period } from './Events';
import { VerdictTag } from './Report';

/** "+12,3% vs período anterior" com tom (subir é bom em todos os KPIs do painel). */
function Delta({ d }: { d: number | null }) {
  if (d === null) return <span>sem período anterior</span>;
  const up = d >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? 'text-brand-700' : 'text-signal'}`}>
      <Icon size={12} aria-hidden="true" />
      {up ? '+' : ''}
      {fmt.pct(d)} <span className="text-gray-500">vs anterior</span>
    </span>
  );
}

const SEVERITY: Record<Insight['severity'], { icon: typeof Trophy; label: string; cls: string }> = {
  critical: { icon: OctagonAlert, label: 'Crítico', cls: 'text-signal bg-signal/10' },
  warning: { icon: AlertTriangle, label: 'Atenção', cls: 'text-[#8a6a00] bg-[#b08600]/12' },
  good: { icon: Trophy, label: 'Resultado', cls: 'text-brand-700 bg-lime/60' },
  info: { icon: Lightbulb, label: 'Ideia', cls: 'text-gray-600 bg-gray-100' },
};

/** Achados automáticos: ícone + rótulo de gravidade (nunca só cor), título e o que fazer. */
function Insights({ list }: { list: Insight[] }) {
  const [all, setAll] = useState(false);
  if (!list.length)
    return (
      <p className="text-sm text-gray-500">
        Nada fora do normal no período. Os achados aparecem aqui assim que houver dados suficientes.
      </p>
    );
  const shown = all ? list : list.slice(0, 5);
  return (
    <>
      <ul className="divide-y divide-gray-900/[0.06]" data-testid="insights">
        {shown.map((x) => {
          const s = SEVERITY[x.severity];
          return (
            <li key={x.id}>
              <button
                onClick={() => navigate(x.link.view, x.link.params)}
                className="flex w-full gap-3 py-3 text-left hover:bg-paper/60"
                data-testid="insight"
              >
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${s.cls}`}>
                  <s.icon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="label-mono shrink-0">{s.label}</span>
                    <span className="truncate text-sm font-medium text-ink">{x.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">{x.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > 5 && (
        <button className="mt-2 text-xs text-brand-700 hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Mostrar menos' : `Ver todos os ${list.length} achados`}
        </button>
      )}
    </>
  );
}

/** Bloco de módulo: número grande + legenda + link para a tela do módulo. */
function Module({ title, view, children }: { title: string; view: string; children: ReactNode }) {
  return (
    <button
      onClick={() => navigate(view)}
      className="group rounded-lg border border-gray-900/10 bg-white px-4 py-3 text-left transition-colors hover:border-brand-500/40"
    >
      <p className="label-mono flex justify-between">
        {title}
        <span className="text-gray-400 group-hover:text-brand-600" aria-hidden="true">
          →
        </span>
      </p>
      <div className="mt-2 space-y-0.5 text-sm text-gray-600">{children}</div>
    </button>
  );
}
const Big = ({ children }: { children: ReactNode }) => (
  <p className="tabular text-[22px] leading-tight font-semibold tracking-tight text-ink">{children}</p>
);

/** Receita por canal: carrega à parte do painel (rota própria, mais pesada). */
function ChannelRevenue({ days }: { days: number }) {
  const [event, setEvent] = useState('');
  const { data } = useLoad(() => getAttribution(days, event || undefined), [days, event]);
  const names = data?.events ?? [];
  return (
    <Card
      title="Receita por canal"
      action={
        <select
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          className={selectCls}
          aria-label="Conversão"
          data-testid="attribution-event"
        >
          <option value="">Eventos com receita</option>
          {[...names.map((n) => n.key), ...(event && !names.some((n) => n.key === event) ? [event] : [])].map(
            (n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ),
          )}
        </select>
      }
    >
      {!data ? (
        <LoadingBlock rows={4} />
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">
            {fmt.int(data.conversions)} {data.conversions === 1 ? 'conversão' : 'conversões'}
            {data.revenue > 0 && ` · ${fmt.money(data.revenue)}`}
          </p>
          <AttributionTable data={data} />
        </>
      )}
    </Card>
  );
}

/** Bloco que ainda não chegou: esqueleto, ou "não carregou" com botão (o aviso de limite aparece uma vez só). */
function Pending({ error, retry, rows = 3 }: { error: Error | null; retry(): void; rows?: number }) {
  if (!error) return <LoadingBlock rows={rows} />;
  return (
    <p className="text-sm text-gray-500" data-testid="block-failed">
      Não carregou.{' '}
      <button className="text-brand-700 hover:underline" onClick={retry}>
        Tentar de novo
      </button>
    </p>
  );
}

const WEEKS = MAX_USEFUL_DAYS / 7;

export function DashboardPage() {
  // 7 dias por padrão: o período mais leve para o servidor grátis (30/90 dias somam agregados diários).
  const [days, setDays] = useState<Period>('7');
  useEffect(() => {
    document.title = 'Painel · Experimenta';
  }, []);
  const n = Number(days);
  // Cada bloco numa requisição: o que chega aparece, o que estoura mostra só o próprio "não carregou".
  const sum = useLoad(() => getDashboardBlock('summary', n), [days]);
  const exp = useLoad(() => getDashboardBlock('experiments', n), [days]);
  const ins = useLoad(() => getDashboardBlock('insights', n), [days]);
  const prof = useLoad(() => getDashboardBlock('profiles', n), [days]);
  const s = sum.data;
  const t = s?.traffic;
  const experiments = exp.data?.experiments;
  const insights = ins.data?.insights;
  const profiles = prof.data?.profiles;
  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title="Painel"
        description="O pulso da conta: tráfego, testes no ar e o que cada módulo encontrou no período."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-6 space-y-5" data-testid="dashboard">
        <Card
          title={`Insights automáticos${insights?.length ? ` (${insights.length})` : ''}${n > 7 ? ' · últimos 7 dias' : ''}`}
        >
          {insights ? <Insights list={insights} /> : <Pending error={ins.error} retry={ins.reload} />}
        </Card>
        {t ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Visitantes" value={fmt.int(t.visitors)} hint={<Delta d={t.deltas.visitors} />} />
            <Stat label="Sessões" value={fmt.int(t.sessions)} hint={<Delta d={t.deltas.sessions} />} />
            <Stat
              label="Páginas vistas"
              value={fmt.int(t.pageviews)}
              hint={<Delta d={t.deltas.pageviews} />}
            />
            <Stat
              label="Conversões em testes"
              value={fmt.int(t.conversions)}
              hint={<Delta d={t.deltas.conversions} />}
            />
            <Stat label="Receita" value={fmt.money(t.revenue)} hint={<Delta d={t.deltas.revenue} />} />
          </div>
        ) : sum.error ? (
          <Pending error={sum.error} retry={sum.reload} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {['Visitantes', 'Sessões', 'Páginas vistas', 'Conversões em testes', 'Receita'].map((l) => (
              <Stat key={l} label={l} value={<Skeleton className="h-7 w-16" />} />
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card title="Visitantes por dia">
            {s && t ? (
              <>
                <LineChart
                  area
                  labels={t.series.map((x) => shortDay(x.day))}
                  series={[
                    { name: 'Visitantes', color: SERIES[0]!, values: t.series.map((x) => x.visitors) },
                  ]}
                />
                {s.pendingDays > 0 && (
                  <p className="mt-2 text-xs text-gray-500" data-testid="pending-days">
                    {s.pendingDays} {s.pendingDays === 1 ? 'dia ainda está' : 'dias ainda estão'} sendo
                    consolidados; os totais sobem quando terminar.
                  </p>
                )}
              </>
            ) : (
              <Pending error={sum.error} retry={sum.reload} rows={6} />
            )}
          </Card>
          <Card title={`Testes no ar${experiments ? ` (${experiments.length})` : ''}`}>
            {!experiments ? (
              <Pending error={exp.error} retry={exp.reload} />
            ) : !experiments.length ? (
              <EmptyState icon={<FlaskConical size={20} aria-hidden="true" />} title="Nenhum teste rodando">
                Crie um experimento e publique para ver o líder aqui.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-gray-900/[0.06]" data-testid="dashboard-experiments">
                {experiments.map((x) => {
                  const open = x.leader?.verdict !== 'winner';
                  return (
                    <li key={x.id}>
                      <button
                        onClick={() => navigate('report', { id: x.id })}
                        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-paper/60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{x.name}</span>
                          <span className="block text-xs text-gray-500">
                            {fmt.int(x.visitors)} visitantes
                            {x.leader?.lift != null &&
                              ` · ${x.leader.name} ${x.leader.lift >= 0 ? '+' : ''}${fmt.pct(x.leader.lift)}`}
                            {open &&
                              x.duration.kind === 'ok' &&
                              x.duration.days > 0 &&
                              ` · ~${x.duration.days} d restantes`}
                          </span>
                          {open && x.duration.kind === 'too-long' && (
                            <span className="mt-0.5 block text-xs text-[#8a6a00]" data-testid="too-long">
                              Mais de {WEEKS} semanas no ritmo atual: não espere concluir. Encerre ou
                              redesenhe (efeito mínimo maior, mais tráfego ou meta mais próxima).
                            </span>
                          )}
                        </span>
                        {x.srm && (
                          <span className="rounded-sm bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-signal uppercase">
                            SRM
                          </span>
                        )}
                        {x.leader && <VerdictTag v={x.leader.verdict} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {s ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Module title="Frustração" view="heatmaps">
              <Big>{fmt.int(s.behavior.rage + s.behavior.dead)}</Big>
              <p>
                {fmt.int(s.behavior.rage)} rage · {fmt.int(s.behavior.dead)} dead clicks
              </p>
              {s.behavior.worstPage && (
                <p className="truncate font-mono text-[11px]" title={s.behavior.worstPage}>
                  pior: {s.behavior.worstPage.replace(/^https?:\/\/[^/]+/, '') || '/'}
                </p>
              )}
            </Module>
            <Module title="Scroll médio" view="heatmaps">
              <Big>{s.behavior.avgScroll != null ? `${s.behavior.avgScroll}%` : 'n/d'}</Big>
              <p>da página, média entre páginas</p>
            </Module>
            <Module title="Formulários" view="forms">
              <Big>{s.forms.completion != null ? fmt.pct(s.forms.completion, 0) : 'n/d'}</Big>
              <p>
                concluem · {fmt.int(s.forms.submitted)} de {fmt.int(s.forms.interacted)} que começaram
              </p>
            </Module>
            <Module title="Pop-ups e pesquisas" view="popups">
              <Big>{fmt.int(s.engage.views)}</Big>
              <p>
                exibições · {fmt.int(s.engage.clicks)} cliques · {fmt.int(s.engage.surveyResponses)} respostas
              </p>
            </Module>
            <Module title="Perfis identificados" view="profiles">
              <Big>{profiles ? fmt.int(profiles.identified) : prof.error ? 'n/d' : '…'}</Big>
              <p>
                {profiles
                  ? `${fmt.int(profiles.multiDevice)} em mais de um dispositivo`
                  : prof.error
                    ? 'não carregou'
                    : 'carregando'}
              </p>
            </Module>
            <Module title="Dispositivos" view="events">
              {Object.entries(s.traffic.devices)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <p key={k} className="flex justify-between">
                    <span>{{ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' }[k] ?? k}</span>
                    <span className="tabular font-mono text-xs">
                      {s.traffic.pageviews ? fmt.pct(v / s.traffic.pageviews, 0) : 'n/d'}
                    </span>
                  </p>
                ))}
              {!Object.keys(s.traffic.devices).length && <Big>n/d</Big>}
            </Module>
            <Module title="Eventos" view="events">
              <Big>{fmt.int(s.traffic.events)}</Big>
              <p className="flex items-center gap-1">
                <Activity size={12} aria-hidden="true" /> eventos customizados
              </p>
            </Module>
          </div>
        ) : (
          !sum.error && <LoadingBlock rows={4} />
        )}
        <ChannelRevenue days={n} />
      </div>
    </>
  );
}
