import { Grid3x3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { query } from '../api';
import { Card, EmptyState, fmt, inputCls, LoadingBlock, PageHeader, Segmented, useLoad } from '../ui';

interface Cohorts {
  unit: 'day' | 'week';
  metric: 'retention' | 'event';
  periods: number;
  cohorts: { start: string; size: number; values: ({ count: number; rate: number } | null)[] }[];
}

/** Escala sequencial de um tom (verde da marca): mais escuro = maior taxa. Texto troca para branco no escuro. */
function cellStyle(rate: number) {
  const a = 0.06 + rate * 0.88;
  return { background: `rgba(18, 130, 95, ${a})`, color: a > 0.55 ? '#fff' : '#16181d' };
}

export function CohortsPage() {
  const [unit, setUnit] = useState<'week' | 'day'>('week');
  const [metric, setMetric] = useState<'retention' | 'event'>('retention');
  const [event, setEvent] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    document.title = 'Coortes · Experimenta';
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(event), event ? 300 : 0);
    return () => clearTimeout(t);
  }, [event]);
  const ev = metric === 'event' ? debounced || undefined : undefined;
  const { data } = useLoad(
    () => query<Cohorts>('/analytics/cohorts', { unit, metric, event: ev, days: unit === 'week' ? 56 : 14 }),
    [unit, metric, ev],
  );
  const label = unit === 'week' ? 'Semana' : 'Dia';
  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Coortes"
        description="Visitantes agrupados pela data da primeira visita. Veja quantos voltam ao site e quantos convertem com o passar do tempo."
        actions={
          <span className="flex flex-wrap gap-2">
            <Segmented
              label="Métrica"
              value={metric}
              onChange={setMetric}
              options={[
                ['retention', 'Retenção'],
                ['event', 'Conversão'],
              ]}
            />
            <Segmented
              label="Granularidade"
              value={unit}
              onChange={setUnit}
              options={[
                ['week', 'Semanas'],
                ['day', 'Dias'],
              ]}
            />
          </span>
        }
      />
      {metric === 'event' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          Evento:
          <input
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="vazio = qualquer conversão de meta"
            className={`${inputCls} max-w-72 py-1.5 font-mono text-xs`}
          />
        </div>
      )}
      <div className="mt-5">
        {!data ? (
          <LoadingBlock rows={8} />
        ) : !data.cohorts.length ? (
          <EmptyState icon={<Grid3x3 size={20} aria-hidden="true" />} title="Sem visitantes no período" />
        ) : (
          <Card
            title={
              metric === 'retention'
                ? `% que voltou ao site em cada ${label.toLowerCase()} depois da primeira visita`
                : `% acumulado que converteu${ev ? ` (${ev})` : ''}`
            }
          >
            <div className="overflow-x-auto">
              <table
                className="w-full border-separate border-spacing-[2px] text-sm"
                data-testid="cohort-table"
              >
                <thead>
                  <tr className="label-mono">
                    <th className="px-2 py-1.5 text-left font-medium">Coorte</th>
                    <th className="px-2 py-1.5 text-right font-medium">Visitantes</th>
                    {Array.from({ length: data.periods }, (_, i) => (
                      <th key={i} className="px-2 py-1.5 text-center font-medium">
                        {label} {i}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.start}>
                      <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap text-ink">
                        {new Date(`${c.start}T12:00:00Z`).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right font-mono text-xs">{fmt.int(c.size)}</td>
                      {c.values.map((v, i) => (
                        <td
                          key={i}
                          className="tabular min-w-14 rounded-[3px] px-2 py-1.5 text-center font-mono text-[11.5px]"
                          style={v ? cellStyle(v.rate) : undefined}
                          title={v ? `${fmt.int(v.count)} de ${fmt.int(c.size)}` : 'ainda não aconteceu'}
                        >
                          {v ? fmt.pct(v.rate, 0) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              A primeira visita considera o período carregado ({unit === 'week' ? '8 semanas' : '14 dias'});
              quem veio antes dele entra na coorte da primeira visita dentro do período.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
