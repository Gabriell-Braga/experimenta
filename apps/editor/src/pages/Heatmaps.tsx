import type { HeatmapMode } from '@abtest/shared';
import { ArrowLeft, Flame, Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createEditSession, frameUrl, getHeatmap, query, type HeatmapFilters } from '../api';
import { HeatmapPanel, type HeatmapResult } from '../components/HeatmapPanel';
import { DEVICE_WIDTH, type Device } from '../components/TopBar';
import { connectAgent, type AgentPeer } from '../connection';
import { navigate } from '../nav';
import { Button, EmptyState, fmt, PageHeader, Segmented, Spinner, useToast } from '../ui';
import { PERIODS, type Period } from './Events';

export interface PageRow {
  page: string;
  href: string;
  title: string;
  pageviews: number;
  visitors: number;
  clicks: number;
  rage: number;
  dead: number;
  avgScroll: number | null;
}

/** Lista de páginas com dados de comportamento (entrada do módulo Mapas de calor). */
export function HeatmapsPage() {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [rows, setRows] = useState<PageRow[] | null>(null);
  useEffect(() => {
    document.title = 'Mapas de calor | Experimenta';
  }, []);
  useEffect(() => {
    query<PageRow[]>('/analytics/pages', { days }).then(setRows, (e: Error) => toast('error', e.message));
  }, [days, toast]);
  const max = Math.max(1, ...(rows ?? []).map((r) => r.pageviews));
  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Mapas de calor"
        description="Cliques, scroll, movimento do mouse e cliques de frustração desenhados sobre o seu site real. Escolha uma página."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-6 overflow-hidden rounded-lg border border-gray-900/10 bg-white">
        {rows && !rows.length ? (
          <EmptyState icon={<Flame size={20} aria-hidden="true" />} title="Nenhuma página com dados ainda">
            A captura vale para a fração de visitantes definida em Configurações da conta. Publique e navegue
            pelo site.
          </EmptyState>
        ) : (
          <table className="w-full text-left text-sm" data-testid="pages-table">
            <thead className="border-b border-gray-900/10 bg-gray-50">
              <tr className="label-mono">
                <th className="px-4 py-2.5 font-medium">Página</th>
                <th className="px-4 py-2.5 text-right font-medium">Vistas</th>
                <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Visitantes</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Cliques</th>
                <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Rage / dead</th>
                <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Scroll médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900/[0.06]">
              {(rows ?? []).map((r) => (
                <tr
                  key={r.page}
                  className="group cursor-pointer hover:bg-lime-soft/40"
                  onClick={() => navigate('heatmap', { url: r.href })}
                  data-testid="page-row"
                >
                  <td className="max-w-md px-4 py-3">
                    <span className="block truncate font-medium text-ink group-hover:underline decoration-lime decoration-2 underline-offset-4">
                      {r.title || r.page.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-gray-400">
                      {r.page.replace(/^https?:\/\//, '')}
                    </span>
                    <span className="mt-1.5 block h-1 rounded-full bg-gray-100">
                      <span
                        className="block h-full rounded-full bg-brand-500"
                        style={{ width: `${(r.pageviews / max) * 100}%` }}
                      />
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs">{fmt.int(r.pageviews)}</td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs md:table-cell">
                    {fmt.int(r.visitors)}
                  </td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs sm:table-cell">
                    {fmt.int(r.clicks)}
                  </td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs lg:table-cell">
                    <span className={r.rage + r.dead ? 'text-signal' : 'text-gray-400'}>
                      {r.rage} / {r.dead}
                    </span>
                  </td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs lg:table-cell">
                    {r.avgScroll === null ? 'n/d' : `${r.avgScroll}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows === null && (
          <div className="grid place-items-center py-16 text-gray-400">
            <Spinner />
          </div>
        )}
      </div>
    </>
  );
}

const DEVICES: [Device, string, LucideIcon][] = [
  ['desktop', 'Desktop', Monitor],
  ['tablet', 'Tablet', Tablet],
  ['mobile', 'Celular', Smartphone],
];

/**
 * Visualizador em tela cheia: o site real no iframe (via sessão de edição + agent, em modo navegar) com o
 * mapa de calor desenhado por cima. Navegar no site troca a página analisada.
 */
export function HeatmapViewer({ url }: { url: string }) {
  const toast = useToast();
  const iframe = useRef<HTMLIFrameElement>(null);
  const peer = useRef<AgentPeer | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [current, setCurrent] = useState(url);
  const [ready, setReady] = useState(0);
  const [device, setDevice] = useState<Device>('desktop');
  const [mode, setMode] = useState<HeatmapMode>('heat');
  const [filters, setFilters] = useState<HeatmapFilters>({});
  const [data, setData] = useState<HeatmapResult | null>(null);
  const [missing, setMissing] = useState(0);
  const siteOrigin = new URL(url).origin;

  useEffect(() => {
    document.title = 'Mapa de calor | Experimenta';
    createEditSession().then(setToken, (e: Error) => toast('error', e.message));
  }, [toast]);
  useEffect(() => {
    if (!token) return;
    const c = connectAgent({
      frame: () => iframe.current?.contentWindow,
      siteOrigin,
      token,
      onPrompt: async () => null,
    });
    peer.current = c.peer;
    const off = c.peer.on('ready', ({ url: u }) => {
      const clean = new URL(u);
      clean.searchParams.delete('abt_edit');
      setCurrent(clean.href);
      setConnected(true);
      setReady((n) => n + 1);
      c.peer.call('setMode', { mode: 'browse' }).catch(() => {});
    });
    return () => {
      off();
      c.dispose();
      peer.current = null;
    };
  }, [token, siteOrigin]);
  // Dispositivo do mapa acompanha a largura do iframe.
  useEffect(() => setFilters((f) => ({ ...f, device: device === 'desktop' ? undefined : device })), [device]);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    setData(null);
    getHeatmap(current, filters).then(
      (d) => live && setData(d),
      (e: Error) => toast('error', e.message),
    );
    return () => {
      live = false;
    };
  }, [connected, ready, current, filters, toast]);
  useEffect(() => {
    if (!connected || !data) return;
    const { page: _page, ...d } = data;
    peer.current?.call('showHeatmap', { ...d, mode }).then(
      (r) => setMissing(r.missing),
      () => {},
    );
  }, [connected, data, mode]);

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-ink px-3 text-white">
        <Button variant="inverse" size="sm" onClick={() => navigate('heatmaps')}>
          <ArrowLeft size={15} aria-hidden="true" /> Mapas de calor
        </Button>
        <span className="h-6 w-px bg-white/15" />
        <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-white/70">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-lime' : 'animate-pulse bg-amber-400'}`}
          />
          <span className="truncate" data-testid="viewer-url">
            {current.replace(/^https?:\/\//, '')}
          </span>
        </span>
        <div className="flex-1" />
        <div className="flex rounded-md bg-white/10 p-0.5" role="group" aria-label="Dispositivo">
          {DEVICES.map(([d, label, Icon]) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              aria-pressed={device === d}
              title={label}
              className={`rounded-[5px] px-2.5 py-1 ${device === d ? 'bg-white text-ink' : 'text-white/70 hover:text-white'}`}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="grid-paper relative flex min-w-0 flex-1 justify-center overflow-auto bg-gray-100 p-3">
          {!connected && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <span className="flex items-center gap-2 rounded-md bg-white px-4 py-3 text-sm text-gray-600 shadow-lg">
                <Spinner className="h-4 w-4 text-brand-500" /> Conectando ao site…
              </span>
            </div>
          )}
          {token && (
            <iframe
              ref={iframe}
              title="Site com mapa de calor"
              data-testid="site-frame"
              src={frameUrl(url, token)}
              style={{ width: DEVICE_WIDTH[device] }}
              className="h-full max-w-full rounded-md bg-white shadow-[0_10px_30px_-12px_rgb(22_24_29/0.35)] ring-1 ring-gray-900/10 transition-[width]"
            />
          )}
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-900/10 bg-white">
          <HeatmapPanel
            mode={mode}
            onMode={setMode}
            filters={filters}
            onFilters={setFilters}
            data={data}
            missing={missing}
            onHighlight={(selector) => peer.current?.call('highlight', { selector }).catch(() => {})}
          />
        </aside>
      </div>
    </div>
  );
}
