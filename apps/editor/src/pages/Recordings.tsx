import type { TrackingEvent } from '@abtest/shared';
import {
  ArrowLeft,
  FastForward,
  Monitor,
  MousePointerClick,
  Pause,
  Play,
  Smartphone,
  Tablet,
  Target,
  Video,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getRecording, listRecordings } from '../api';
import { navigate } from '../nav';
import {
  Button,
  EmptyState,
  fmt,
  inputCls,
  PageHeader,
  Segmented,
  LoadingBlock,
  selectCls,
  Spinner,
  timeAgo,
  useLoad,
  useToast,
} from '../ui';
import { PERIODS, type Period } from './Events';

export const DEVICE_ICON: Record<string, LucideIcon> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};
const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, '') || '/';

export function RecordingsPage({ params }: { params: URLSearchParams }) {
  const [days, setDays] = useState<Period>('30');
  const [device, setDevice] = useState('');
  const [page, setPage] = useState('');
  const [dPage, setDPage] = useState('');
  const [minSeconds, setMinSeconds] = useState('');
  const [frustrated, setFrustrated] = useState(false);
  const visitorId = params.get('visitor') ?? undefined;
  useEffect(() => {
    document.title = 'Gravações · Experimenta';
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDPage(page), page ? 300 : 0);
    return () => clearTimeout(t);
  }, [page]);
  const { data: rows } = useLoad(
    () =>
      listRecordings({
        days,
        device: device || undefined,
        page: dPage || undefined,
        minSeconds: minSeconds || undefined,
        frustrated: frustrated ? '1' : undefined,
        visitorId,
      }),
    [days, device, dPage, minSeconds, frustrated, visitorId],
  );

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Gravações de sessão"
        description="Assista à visita como o visitante viu: cliques, scroll, navegação e frustração. Campos de formulário sempre mascarados."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
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
        <input
          value={page}
          onChange={(e) => setPage(e.target.value)}
          placeholder="Visitou a página… (ex.: /checkout)"
          className={`${inputCls} max-w-64`}
          aria-label="Página visitada"
        />
        <select
          value={minSeconds}
          onChange={(e) => setMinSeconds(e.target.value)}
          className={selectCls}
          aria-label="Duração mínima"
        >
          <option value="">Qualquer duração</option>
          <option value="10">10 s ou mais</option>
          <option value="30">30 s ou mais</option>
          <option value="60">1 min ou mais</option>
          <option value="300">5 min ou mais</option>
        </select>
        <label className="flex items-center gap-2 rounded-md border border-gray-900/10 bg-white px-2.5 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={frustrated}
            onChange={(e) => setFrustrated(e.target.checked)}
            data-testid="only-frustrated"
          />
          Só com frustração
        </label>
        {visitorId && (
          <Button size="sm" variant="ghost" onClick={() => navigate('recordings')}>
            Visitante {visitorId.slice(0, 8)} ×
          </Button>
        )}
      </div>
      {rows === null ? (
        <LoadingBlock className="mt-4" rows={8} />
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-900/10 bg-white">
          {!rows.length ? (
            <EmptyState
              icon={<Video size={20} aria-hidden="true" />}
              title="Nenhuma sessão gravada com esses filtros"
            >
              A gravação vale para a fração de visitantes definida em Configurações da conta (a mesma do mapa
              de calor).
            </EmptyState>
          ) : (
            <ul className="divide-y divide-gray-900/[0.06]" data-testid="recordings">
              {rows.map((r) => {
                const Icon = DEVICE_ICON[r.device] ?? Monitor;
                return (
                  <li key={r.sessionId}>
                    <button
                      onClick={() => navigate('recording', { id: r.sessionId })}
                      className="group flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-lime-soft/40"
                      data-testid="recording-row"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink text-lime group-hover:bg-brand-600 group-hover:text-white">
                        <Play size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-ink">
                          <span className="truncate">{path(r.pages[0] ?? '')}</span>
                          {r.pages.length > 1 && (
                            <span className="shrink-0 font-mono text-[11px] font-normal text-gray-500">
                              +{r.pages.length - 1} página{r.pages.length > 2 ? 's' : ''}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-3 font-mono text-[11px] text-gray-500">
                          <span title={new Date(r.startedAt).toLocaleString('pt-BR')}>
                            {timeAgo(r.startedAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Icon size={12} aria-hidden="true" /> {r.vw}×{r.vh}
                          </span>
                          <span>visitante {r.visitorId.slice(0, 8)}</span>
                        </span>
                      </span>
                      <span className="hidden items-center gap-3 font-mono text-[11px] text-gray-600 sm:flex">
                        <span className="flex items-center gap-1" title="Cliques">
                          <MousePointerClick size={13} aria-hidden="true" /> {r.clicks}
                        </span>
                        {r.rage + r.dead > 0 && (
                          <span
                            className="rounded-sm bg-signal/10 px-1.5 py-0.5 text-signal"
                            title="Rage / dead clicks"
                          >
                            {r.rage} rage · {r.dead} dead
                          </span>
                        )}
                        {r.conversions > 0 && (
                          <span
                            className="rounded-sm bg-lime-soft px-1.5 py-0.5 text-brand-900"
                            title="Conversões"
                          >
                            {r.conversions} conv.
                          </span>
                        )}
                      </span>
                      <span className="tabular w-14 shrink-0 text-right font-mono text-xs text-ink">
                        {fmt.dur(r.durationMs)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

const MARK: Record<string, [string, string, LucideIcon]> = {
  pageview: ['Página', '#16181d', Monitor],
  click: ['Clique', '#a49d8f', MousePointerClick],
  frustration: ['Frustração', '#e8552d', Zap],
  conversion: ['Conversão', '#12825f', Target],
  event: ['Evento', '#3d6be0', Target],
};

function describe(e: TrackingEvent): string {
  if (e.type === 'pageview') return path(e.url);
  if (e.type === 'click') return e.selector;
  if (e.type === 'frustration') return `${e.kind === 'rage' ? 'Rage click' : 'Dead click'} em ${e.selector}`;
  if (e.type === 'conversion') return `${e.goalKey} (${e.experimentKey})`;
  if (e.type === 'event') return e.name;
  return e.type;
}

/** Reprodução de uma sessão (rrweb) com controles próprios e linha do tempo dos nossos eventos. */
export function RecordingPlayer({ id }: { id: string }) {
  const toast = useToast();
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<import('@rrweb/replay').Replayer | null>(null);
  const [meta, setMeta] = useState<{ start: number; total: number } | null>(null);
  const [timeline, setTimeline] = useState<TrackingEvent[]>([]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [skip, setSkip] = useState(true);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [box, setBox] = useState({ w: 800, h: 500 });

  useEffect(() => {
    document.title = 'Gravação · Experimenta';
    let alive = true;
    let r: import('@rrweb/replay').Replayer | null = null;
    Promise.all([getRecording(id), import('@rrweb/replay'), import('@rrweb/replay/dist/style.css')])
      .then(([rec, { Replayer }]) => {
        if (!alive || !host.current) return;
        r = new Replayer(rec.events as never, {
          root: host.current,
          skipInactive: true,
          showWarning: false,
          mouseTail: { strokeStyle: '#d4f15b', lineWidth: 3 },
          triggerFocus: false,
        });
        r.on('resize', (d: unknown) => {
          const s = d as { width: number; height: number };
          setSize({ w: s.width, h: s.height });
        });
        r.on('finish', () => setPlaying(false));
        player.current = r;
        const m = r.getMetaData();
        setMeta({ start: m.startTime, total: m.totalTime });
        setTimeline(rec.timeline);
        r.play(0);
        setPlaying(true);
      })
      .catch((e: Error) => toast('error', e.message));
    return () => {
      alive = false;
      r?.destroy();
      player.current = null;
    };
  }, [id, toast]);

  // Relógio da UI.
  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setT(player.current?.getCurrentTime() ?? 0), 200);
    return () => clearInterval(i);
  }, [playing]);
  // Encaixa o viewport gravado no palco (escala proporcional).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, box.w / size.w, box.h / size.h);

  const seek = (ms: number) => {
    const p = player.current;
    if (!p) return;
    const at = Math.max(0, Math.min(meta?.total ?? 0, ms));
    if (playing) p.play(at);
    else p.pause(at);
    setT(at);
  };
  const toggle = () => {
    const p = player.current;
    if (!p || !meta) return;
    if (playing) {
      p.pause();
      setPlaying(false);
    } else {
      p.play(t >= meta.total ? 0 : t);
      setPlaying(true);
    }
  };
  const marks = useMemo(
    () =>
      meta
        ? timeline
            // Eventos da mesma sessão antes de a gravação começar (amostragem ligou depois) ficam de fora.
            .filter((e) => MARK[e.type] && e.ts >= meta.start - 1000)
            .map((e) => ({ e, at: Math.max(0, Math.min(meta.total, e.ts - meta.start)) }))
        : [],
    [timeline, meta],
  );

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-ink px-3 text-white">
        <Button variant="inverse" size="sm" onClick={() => navigate('recordings')}>
          <ArrowLeft size={15} aria-hidden="true" /> Gravações
        </Button>
        <span className="h-6 w-px bg-white/15" />
        <span className="font-mono text-xs text-white/60">sessão {id.slice(0, 8)}</span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-white/50">
          {size.w}×{size.h} · {Math.round(scale * 100)}%
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={stage} className="grid-paper relative min-h-0 flex-1 overflow-hidden bg-gray-100">
            {!meta && (
              <div className="absolute inset-0 grid place-items-center text-gray-500">
                <Spinner />
              </div>
            )}
            <div
              className="absolute top-1/2 left-1/2 overflow-hidden rounded-md bg-white shadow-[0_10px_30px_-12px_rgb(22_24_29/0.35)] ring-1 ring-gray-900/10"
              style={{
                width: size.w,
                height: size.h,
                transform: `translate(-50%, -50%) scale(${scale})`,
              }}
            >
              <div ref={host} className="abt-replay" data-testid="replay" />
            </div>
          </div>
          <div className="shrink-0 border-t border-gray-900/10 bg-white px-4 py-3">
            {/* Linha do tempo com marcadores dos eventos (clicáveis). */}
            <div
              className="relative h-7 cursor-pointer"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * (meta?.total ?? 0));
              }}
              data-testid="timeline"
            >
              <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-gray-100" />
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink"
                style={{ width: `${meta?.total ? (t / meta.total) * 100 : 0}%` }}
              />
              {marks.map(({ e, at }) => (
                <span
                  key={e.eventId}
                  title={`${MARK[e.type]![0]}: ${describe(e)}`}
                  className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                  style={{
                    left: `${meta?.total ? (at / meta.total) * 100 : 0}%`,
                    background: MARK[e.type]![1],
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                onClick={toggle}
                aria-label={playing ? 'Pausar' : 'Reproduzir'}
                data-testid="play"
              >
                {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </Button>
              <span className="tabular font-mono text-xs text-ink" data-testid="clock">
                {fmt.dur(t)} / {fmt.dur(meta?.total ?? 0)}
              </span>
              <div className="flex-1" />
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={skip}
                  onChange={(e) => {
                    setSkip(e.target.checked);
                    player.current?.setConfig({ skipInactive: e.target.checked });
                  }}
                />
                <FastForward size={13} aria-hidden="true" /> Pular inatividade
              </label>
              <Segmented
                label="Velocidade"
                value={String(speed)}
                onChange={(v) => {
                  setSpeed(Number(v));
                  player.current?.setConfig({ speed: Number(v) });
                }}
                options={[
                  ['1', '1×'],
                  ['2', '2×'],
                  ['4', '4×'],
                  ['8', '8×'],
                ]}
              />
            </div>
          </div>
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-900/10 bg-white">
          <p className="label-mono px-4 pt-4 pb-2">Linha do tempo</p>
          <ol className="pb-4" data-testid="timeline-list">
            {marks.map(({ e, at }) => {
              const [label, color, Icon] = MARK[e.type]!;
              return (
                <li key={e.eventId}>
                  <button
                    onClick={() => seek(at)}
                    className={`flex w-full items-start gap-2.5 px-4 py-1.5 text-left text-[13px] hover:bg-gray-50 ${Math.abs(at - t) < 1000 ? 'bg-lime-soft/50' : ''}`}
                  >
                    <span className="tabular mt-0.5 w-10 shrink-0 font-mono text-[11px] text-gray-400">
                      {fmt.dur(at)}
                    </span>
                    <Icon size={14} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-ink">{label}</span>
                      <span
                        className="block truncate font-mono text-[11px] text-gray-500"
                        title={describe(e)}
                      >
                        {describe(e)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {!marks.length && <li className="px-4 text-xs text-gray-400">Sem eventos nesta sessão.</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}
