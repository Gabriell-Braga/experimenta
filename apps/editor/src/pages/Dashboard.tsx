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
import { getDashboard, type Dashboard, type Insight } from '../api';
import { LineChart, SERIES } from '../charts';
import { navigate } from '../nav';
import { Card, EmptyState, fmt, PageHeader, Segmented, Stat, useToast } from '../ui';
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

export function DashboardPage() {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => {
    document.title = 'Painel | Experimenta';
  }, []);
  useEffect(() => {
    getDashboard(Number(days)).then(setD, (e: Error) => toast('error', e.message));
  }, [days, toast]);
  const t = d?.traffic;
  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title="Painel"
        description="O pulso da conta: tráfego, testes no ar e o que cada módulo encontrou no período."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className={`mt-6 space-y-5 transition-opacity ${d ? '' : 'opacity-50'}`} data-testid="dashboard">
        <Card title={`Insights automáticos${d?.insights.length ? ` (${d.insights.length})` : ''}`}>
          {d && <Insights list={d.insights} />}
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat
            label="Visitantes"
            value={fmt.int(t?.visitors ?? 0)}
            hint={t && <Delta d={t.deltas.visitors} />}
          />
          <Stat
            label="Sessões"
            value={fmt.int(t?.sessions ?? 0)}
            hint={t && <Delta d={t.deltas.sessions} />}
          />
          <Stat
            label="Páginas vistas"
            value={fmt.int(t?.pageviews ?? 0)}
            hint={t && <Delta d={t.deltas.pageviews} />}
          />
          <Stat
            label="Conversões em testes"
            value={fmt.int(t?.conversions ?? 0)}
            hint={t && <Delta d={t.deltas.conversions} />}
          />
          <Stat
            label="Receita"
            value={fmt.money(t?.revenue ?? 0)}
            hint={t && <Delta d={t.deltas.revenue} />}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card title="Visitantes por dia">
            <LineChart
              area
              labels={(t?.series ?? []).map((x) => shortDay(x.day))}
              series={[
                { name: 'Visitantes', color: SERIES[0]!, values: (t?.series ?? []).map((x) => x.visitors) },
              ]}
            />
          </Card>
          <Card title={`Testes no ar (${d?.experiments.length ?? 0})`}>
            {d && !d.experiments.length ? (
              <EmptyState icon={<FlaskConical size={20} aria-hidden="true" />} title="Nenhum teste rodando">
                Crie um experimento e publique para ver o líder aqui.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-gray-900/[0.06]" data-testid="dashboard-experiments">
                {d?.experiments.map((x) => (
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
                          {x.daysRemaining != null &&
                            x.daysRemaining > 0 &&
                            x.leader?.verdict !== 'winner' &&
                            ` · ~${x.daysRemaining} d restantes`}
                        </span>
                      </span>
                      {x.srm && (
                        <span className="rounded-sm bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-signal uppercase">
                          SRM
                        </span>
                      )}
                      {x.leader && <VerdictTag v={x.leader.verdict} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Module title="Frustração" view="heatmaps">
            <Big>{fmt.int((d?.behavior.rage ?? 0) + (d?.behavior.dead ?? 0))}</Big>
            <p>
              {fmt.int(d?.behavior.rage ?? 0)} rage · {fmt.int(d?.behavior.dead ?? 0)} dead clicks
            </p>
            {d?.behavior.worstPage && (
              <p className="truncate font-mono text-[11px]" title={d.behavior.worstPage}>
                pior: {d.behavior.worstPage.replace(/^https?:\/\/[^/]+/, '') || '/'}
              </p>
            )}
          </Module>
          <Module title="Scroll médio" view="heatmaps">
            <Big>{d?.behavior.avgScroll != null ? `${d.behavior.avgScroll}%` : 'n/d'}</Big>
            <p>da página, média entre páginas</p>
          </Module>
          <Module title="Formulários" view="forms">
            <Big>{d?.forms.completion != null ? fmt.pct(d.forms.completion, 0) : 'n/d'}</Big>
            <p>
              concluem · {fmt.int(d?.forms.submitted ?? 0)} de {fmt.int(d?.forms.interacted ?? 0)} que
              começaram
            </p>
          </Module>
          <Module title="Pop-ups e pesquisas" view="popups">
            <Big>{fmt.int(d?.engage.views ?? 0)}</Big>
            <p>
              exibições · {fmt.int(d?.engage.clicks ?? 0)} cliques · {fmt.int(d?.engage.surveyResponses ?? 0)}{' '}
              respostas
            </p>
          </Module>
          <Module title="Perfis identificados" view="profiles">
            <Big>{fmt.int(d?.profiles.identified ?? 0)}</Big>
            <p>{fmt.int(d?.profiles.multiDevice ?? 0)} em mais de um dispositivo</p>
          </Module>
          <Module title="Dispositivos" view="events">
            {Object.entries(t?.devices ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <p key={k} className="flex justify-between">
                  <span>{{ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' }[k] ?? k}</span>
                  <span className="tabular font-mono text-xs">
                    {t?.pageviews ? fmt.pct(v / t.pageviews, 0) : 'n/d'}
                  </span>
                </p>
              ))}
            {!Object.keys(t?.devices ?? {}).length && <Big>n/d</Big>}
          </Module>
          <Module title="Eventos" view="events">
            <Big>{fmt.int(t?.events ?? 0)}</Big>
            <p className="flex items-center gap-1">
              <Activity size={12} aria-hidden="true" /> eventos customizados
            </p>
          </Module>
        </div>
      </div>
    </>
  );
}
