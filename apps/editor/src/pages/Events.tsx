import type { TrackingEvent } from '@abtest/shared';
import { Pause, Play, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getOverview, listEvents, type Overview } from '../api';
import { BarList, LineChart, SERIES } from '../charts';
import { Button, Card, EmptyState, fmt, PageHeader, Segmented, Stat, useToast } from '../ui';

export const PERIODS = [
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['90', '90 dias'],
] as const;
export type Period = (typeof PERIODS)[number][0];

/** "19/10" a partir de "2026-10-19". */
export const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, '') || '/';

const TYPE_LABEL: Record<string, string> = {
  pageview: 'página',
  event: 'evento',
  identify: 'identify',
  exposure: 'exposição',
  conversion: 'conversão',
  click: 'clique',
  scroll: 'scroll',
  selector_failed: 'seletor falhou',
  selector_healed: 'seletor curado',
};

function describe(e: TrackingEvent): string {
  switch (e.type) {
    case 'pageview':
      return e.title ? `${path(e.url)} · ${e.title}` : path(e.url);
    case 'event':
      return `${e.name}${e.value !== undefined ? ` · ${fmt.money(e.value)}` : ''}`;
    case 'identify':
      return [e.userId, e.attrs && Object.keys(e.attrs).join(', ')].filter(Boolean).join(' · ');
    case 'exposure':
      return `${e.experimentKey} → ${e.variationKey}`;
    case 'conversion':
      return `${e.experimentKey} → ${e.variationKey} · meta ${e.goalKey}`;
    case 'click':
      return e.selector;
    default:
      return path(e.url);
  }
}

/** Fluxo dos eventos mais recentes, atualizado a cada 5 s (pausável). */
function LiveStream() {
  const [items, setItems] = useState<TrackingEvent[] | null>(null);
  const [live, setLive] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listEvents({ limit: 40 }).then(
        (l) => alive && setItems(l),
        () => {},
      );
    load();
    const t = live ? setInterval(load, 5000) : undefined;
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live]);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Radio size={15} className={live ? 'text-brand-500' : 'text-gray-400'} aria-hidden="true" />
          Ao vivo
        </span>
      }
      action={
        <Button size="sm" variant="ghost" onClick={() => setLive(!live)} data-testid="live-toggle">
          {live ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {live ? 'Pausar' : 'Retomar'}
        </Button>
      }
      pad={false}
    >
      {items && !items.length ? (
        <p className="p-6 text-center text-sm text-gray-400">Nenhum evento recebido ainda.</p>
      ) : (
        <ul
          className="max-h-[420px] divide-y divide-gray-900/[0.05] overflow-y-auto"
          data-testid="live-events"
        >
          {(items ?? []).map((e) => (
            <li key={e.eventId} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="tabular w-14 shrink-0 font-mono text-[11px] text-gray-400">
                {new Date(e.ts).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span
                className={`w-24 shrink-0 font-mono text-[10.5px] uppercase ${e.type === 'conversion' || e.type === 'event' ? 'text-brand-600' : 'text-gray-500'}`}
              >
                {TYPE_LABEL[e.type] ?? e.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-700" title={describe(e)}>
                {describe(e)}
              </span>
              <span
                className="hidden shrink-0 font-mono text-[10.5px] text-gray-400 sm:inline"
                title={e.visitorId}
              >
                {e.visitorId.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function EventsPage() {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    document.title = 'Eventos — Experimenta';
  }, []);
  useEffect(() => {
    getOverview(Number(days)).then(setData, (e: Error) => toast('error', e.message));
  }, [days, toast]);
  const t = data?.totals;
  const empty = data && !t?.pageviews && !t?.events;
  return (
    <>
      <PageHeader
        eyebrow="Dados"
        title="Eventos e tráfego"
        description="Tudo o que o snippet coleta: páginas vistas, eventos customizados, identificações e conversões."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className={`mt-6 space-y-5 transition-opacity ${data ? '' : 'opacity-50'}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="overview-totals">
          <Stat label="Visitantes" value={fmt.int(t?.visitors ?? 0)} />
          <Stat label="Sessões" value={fmt.int(t?.sessions ?? 0)} />
          <Stat label="Páginas vistas" value={fmt.int(t?.pageviews ?? 0)} />
          <Stat label="Eventos" value={fmt.int(t?.events ?? 0)} />
          <Stat label="Receita" value={fmt.money(t?.revenue ?? 0)} hint="soma dos valores dos eventos" />
        </div>
        {empty ? (
          <EmptyState icon={<Radio size={20} aria-hidden="true" />} title="Ainda sem dados neste período">
            Instale o snippet (menu Configurar → Instalação) e navegue pelo site. Os eventos aparecem aqui em
            segundos.
          </EmptyState>
        ) : (
          <Card title="Visitantes e sessões por dia">
            <LineChart
              area
              labels={(data?.series ?? []).map((d) => shortDay(d.day))}
              series={[
                {
                  name: 'Visitantes',
                  color: SERIES[0]!,
                  values: (data?.series ?? []).map((d) => d.visitors),
                },
                { name: 'Sessões', color: SERIES[1]!, values: (data?.series ?? []).map((d) => d.sessions) },
              ]}
            />
          </Card>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Páginas mais vistas">
            <BarList
              items={(data?.topPages ?? []).map((p) => ({ key: p.key, label: path(p.key), value: p.count }))}
            />
          </Card>
          <Card title="Eventos customizados">
            <BarList
              color={SERIES[1]}
              items={(data?.topEvents ?? []).map((p) => ({ key: p.key, label: p.key, value: p.count }))}
              empty="Nenhum evento. Use abq.push(['track', 'nome'])."
            />
          </Card>
          <Card title="Dispositivos">
            <BarList
              color={SERIES[2]}
              items={Object.entries(data?.devices ?? {}).map(([k, v]) => ({
                key: k,
                label: { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' }[k] ?? k,
                value: v,
                hint: t?.pageviews ? fmt.pct(v / t.pageviews, 0) : undefined,
              }))}
            />
          </Card>
          <Card title="Origens (referência externa)">
            <BarList
              color={SERIES[3]}
              items={(data?.referrers ?? []).map((p) => ({ key: p.key, label: p.key, value: p.count }))}
              empty="Sem tráfego vindo de outros sites."
            />
          </Card>
        </div>
        <LiveStream />
      </div>
    </>
  );
}
