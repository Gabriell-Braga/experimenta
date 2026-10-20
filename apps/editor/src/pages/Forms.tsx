import { ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { query } from '../api';
import { BarList, SERIES } from '../charts';
import {
  Card,
  EmptyState,
  fmt,
  LoadingBlock,
  PageHeader,
  Segmented,
  selectCls,
  Skeleton,
  useLoad,
} from '../ui';
import { PERIODS, type Period } from './Events';

interface FieldRow {
  name: string;
  kind: string;
  avgTime: number;
  avgHesitation: number;
  refillRate: number;
  ignoredRate: number;
  dropoffs: number;
  dropoffRate: number;
}
interface FormRow {
  page: string;
  form: string;
  landed: number;
  interacted: number;
  submitted: number;
  avgFillTime: number;
  fields: FieldRow[];
}

const METRICS = [
  ['avgTime', 'Tempo no campo'],
  ['avgHesitation', 'Hesitação'],
  ['refillRate', 'Re-preenchimento'],
  ['ignoredRate', 'Ignorados'],
  ['dropoffRate', 'Abandono'],
] as const;
type Metric = (typeof METRICS)[number][0];

const HELP: Record<Metric, string> = {
  avgTime:
    'Tempo médio com o campo em foco (entre quem focou o campo). Campos lentos costumam ser confusos ou pedir dado que o visitante não tem à mão.',
  avgHesitation:
    'Tempo entre focar o campo e começar a digitar. Hesitação alta indica dúvida sobre o que preencher.',
  refillRate:
    'Quem voltou a editar o campo depois de já tê-lo preenchido. Sinal de erro de validação ou rótulo ambíguo.',
  ignoredRate: 'Quem interagiu com o formulário mas nunca focou este campo. Campos opcionais demais?',
  dropoffRate: 'Entre quem desistiu, em que campo parou. O campo com mais abandono é o principal suspeito.',
};

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
const ms = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : `${n} ms`;

/** Funil do formulário: três barras com a taxa de passagem entre etapas. */
function FormFunnel({ f }: { f: FormRow }) {
  const steps = [
    ['Chegaram', f.landed],
    ['Interagiram', f.interacted],
    ['Enviaram', f.submitted],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="form-funnel">
      {steps.map(([label, n], i) => {
        const prev = i ? steps[i - 1]![1] : n;
        return (
          <div key={label}>
            <div className="flex h-36 items-end rounded-md bg-gray-50 p-1.5">
              <div
                className="w-full rounded-[4px]"
                style={{
                  height: `${f.landed ? Math.max(2, (n / f.landed) * 100) : 0}%`,
                  background: SERIES[i],
                }}
              />
            </div>
            <p className="label-mono mt-2">{label}</p>
            <p className="tabular text-xl font-semibold text-ink">{fmt.int(n)}</p>
            <p className="font-mono text-[11px] text-gray-500">
              {i === 0 ? '100%' : `${prev ? fmt.pct(n / prev, 1) : 'n/d'} da etapa anterior`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function FormsPage() {
  const [days, setDays] = useState<Period>('30');
  const [device, setDevice] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('avgTime');
  useEffect(() => {
    document.title = 'Formulários · Experimenta';
  }, []);
  const { data: rows } = useLoad(
    () => query<FormRow[]>('/analytics/forms', { days, device: device || undefined }),
    [days, device],
  );
  const current = rows?.find((r) => `${r.page}|${r.form}` === sel) ?? rows?.[0];
  const pctMetric = metric === 'refillRate' || metric === 'ignoredRate' || metric === 'dropoffRate';
  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Formulários"
        description="Como os visitantes preenchem seus formulários e onde desistem. Medido sem nunca enviar o que foi digitado."
        actions={
          <span className="flex flex-wrap gap-2">
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
            <Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />
          </span>
        }
      />
      {rows === null ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[74px] w-full" />
            ))}
          </div>
          <div className="space-y-5">
            <LoadingBlock rows={3} />
            <LoadingBlock rows={5} />
          </div>
        </div>
      ) : !rows.length || !current ? (
        <div className="mt-6">
          <EmptyState
            icon={<ClipboardList size={20} aria-hidden="true" />}
            title="Nenhum formulário medido ainda"
          >
            Todo formulário das páginas é medido automaticamente para a fração amostrada de visitantes (mesma
            taxa do mapa de calor).
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1.5">
            <p className="label-mono mb-2">Formulários</p>
            {rows.map((r) => {
              const k = `${r.page}|${r.form}`;
              const active = current === r;
              return (
                <button
                  key={k}
                  onClick={() => setSel(k)}
                  className={`block w-full rounded-md border px-3 py-2.5 text-left ${active ? 'border-ink bg-white' : 'border-gray-900/10 bg-white/50 hover:bg-white'}`}
                  data-testid="form-item"
                >
                  <span className="block truncate font-mono text-[12px] text-ink">{r.form}</span>
                  <span className="block truncate text-xs text-gray-500">{path(r.page)}</span>
                  <span className="tabular mt-1 block font-mono text-[11px] text-gray-600">
                    {fmt.int(r.landed)} → {fmt.int(r.interacted)} →{' '}
                    <b className="text-brand-700">{fmt.int(r.submitted)}</b>
                  </span>
                </button>
              );
            })}
          </aside>
          <div className="min-w-0 space-y-5">
            <Card title={`${current.form} · ${path(current.page)}`}>
              <FormFunnel f={current} />
              <p className="mt-4 text-sm text-gray-600">
                {current.interacted - current.submitted > 0 ? (
                  <>
                    <b className="text-ink">{fmt.int(current.interacted - current.submitted)}</b> visitantes
                    começaram e não enviaram (
                    {fmt.pct((current.interacted - current.submitted) / (current.interacted || 1), 0)} de quem
                    interagiu). Tempo médio de preenchimento:{' '}
                    <b className="text-ink">{ms(current.avgFillTime)}</b>.
                  </>
                ) : (
                  'Ninguém que começou desistiu no período.'
                )}
              </p>
            </Card>
            <Card title="Estatística por campo">
              <Segmented label="Métrica" value={metric} onChange={setMetric} options={METRICS} />
              <p className="mt-2 mb-4 text-xs text-gray-500">{HELP[metric]}</p>
              <BarList
                color={metric === 'dropoffRate' || metric === 'refillRate' ? SERIES[2] : SERIES[1]}
                format={(n) => (pctMetric ? fmt.pct(n, 0) : ms(n))}
                items={current.fields.map((f) => ({
                  key: f.name,
                  label: (
                    <span>
                      {f.name} <span className="font-mono text-[10px] text-gray-400">{f.kind}</span>
                    </span>
                  ),
                  value: f[metric],
                  hint: metric === 'dropoffRate' && f.dropoffs ? `${f.dropoffs} pessoas` : undefined,
                }))}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
