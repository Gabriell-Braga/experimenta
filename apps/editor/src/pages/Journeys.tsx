import { ArrowRight, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { query } from '../api';
import { BarList, SERIES } from '../charts';
import { Card, EmptyState, fmt, PageHeader, Segmented, selectCls, Spinner, useToast } from '../ui';
import { PERIODS, type Period } from './Events';

interface Count {
  key: string;
  count: number;
}
interface Journeys {
  sessions: number;
  bounceRate: number;
  entries: Count[];
  exits: Count[];
  paths: { steps: string[]; count: number }[];
  focus: { page: string; views: number; previous: Count[]; next: Count[] } | null;
}

const path = (u: string) => (u.startsWith('(') ? u : u.replace(/^https?:\/\/[^/]+/, '') || '/');

/** Página clicável no estilo "etiqueta" (abre o explorador daquela página). */
function PageChip({ page, onClick }: { page: string; onClick?(): void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick || page.startsWith('(')}
      className="max-w-56 truncate rounded-sm border border-gray-900/10 bg-white px-2 py-0.5 font-mono text-[11.5px] text-ink enabled:hover:border-ink"
      title={page}
    >
      {path(page)}
    </button>
  );
}

export function JourneysPage() {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [device, setDevice] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [data, setData] = useState<Journeys | null>(null);
  useEffect(() => {
    document.title = 'Jornadas — Experimenta';
  }, []);
  useEffect(() => {
    query<Journeys>('/analytics/journeys', {
      days,
      device: device || undefined,
      page: focus ?? undefined,
    }).then(
      (d) => {
        setData(d);
        if (!focus && d.entries[0]) setFocus(d.entries[0].key);
      },
      (e: Error) => toast('error', e.message),
    );
  }, [days, device, focus, toast]);

  return (
    <>
      <PageHeader
        eyebrow="Insights · Jornada"
        title="Jornadas"
        description="Por onde os visitantes entram, que caminhos percorrem e onde saem. Escolha uma página para ver de onde vêm e para onde vão."
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
      {!data ? (
        <div className="grid place-items-center py-24 text-gray-400">
          <Spinner />
        </div>
      ) : !data.sessions ? (
        <div className="mt-6">
          <EmptyState icon={<Route size={20} aria-hidden="true" />} title="Sem páginas vistas no período" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {data.focus && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  Explorar página <PageChip page={data.focus.page} />
                  <span className="font-mono text-[11px] font-normal text-gray-500">
                    {fmt.int(data.focus.views)} visitas
                  </span>
                </span>
              }
            >
              <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]" data-testid="journey-focus">
                <div>
                  <p className="label-mono mb-2">Vieram de</p>
                  <BarList
                    color={SERIES[1]}
                    items={data.focus.previous.map((c) => ({
                      key: c.key,
                      label: path(c.key),
                      value: c.count,
                    }))}
                    onSelect={(k) => !k.startsWith('(') && setFocus(k)}
                  />
                </div>
                <div className="hidden h-full items-center md:flex">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-ink text-lime">
                    <ArrowRight size={18} aria-hidden="true" />
                  </span>
                </div>
                <div>
                  <p className="label-mono mb-2">Foram para</p>
                  <BarList
                    color={SERIES[0]}
                    items={data.focus.next.map((c) => ({ key: c.key, label: path(c.key), value: c.count }))}
                    onSelect={(k) => !k.startsWith('(') && setFocus(k)}
                  />
                </div>
              </div>
            </Card>
          )}
          <Card title="Caminhos mais comuns">
            <ol className="space-y-2.5" data-testid="journey-paths">
              {data.paths.map((p, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="tabular w-12 shrink-0 text-right font-mono text-xs text-ink">
                    {fmt.int(p.count)}
                  </span>
                  <span className="tabular w-12 shrink-0 font-mono text-[11px] text-gray-400">
                    {fmt.pct(p.count / data.sessions, 0)}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {p.steps.map((s, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <ArrowRight size={12} className="text-gray-400" aria-hidden="true" />}
                        <PageChip page={s} onClick={() => setFocus(s)} />
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title={`Páginas de entrada · ${fmt.int(data.sessions)} sessões, ${fmt.pct(data.bounceRate, 0)} saíram na 1ª página`}
            >
              <BarList
                items={data.entries.map((c) => ({ key: c.key, label: path(c.key), value: c.count }))}
                onSelect={setFocus}
              />
            </Card>
            <Card title="Páginas de saída">
              <BarList
                color={SERIES[2]}
                items={data.exits.map((c) => ({ key: c.key, label: path(c.key), value: c.count }))}
                onSelect={setFocus}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
