// Gráficos em SVG/HTML puro (sem biblioteca). Regras: marcas finas, grade recessiva, legenda com 2+ séries,
// tooltip com crosshair, tabela alternativa. Paleta categórica validada (dataviz/validate_palette.js, claro).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Ordem fixa por entidade (controle, V1, V2…) — nunca reciclada; além de 5, use tabela. */
export const SERIES = ['#12825f', '#3d6be0', '#e8552d', '#8b5cf6', '#b08600'];
export const seriesColor = (i: number) => SERIES[i] ?? '#a49d8f';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Ticks "redondos" de 0 até ~max. */
function niceTicks(max: number, n = 4, integer = false): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  if (integer) step = Math.max(1, Math.round(step));
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => +(i * step).toFixed(10));
}

const compact = (n: number) =>
  n >= 1000 ? new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(n) : String(+n.toFixed(2));

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export function Legend({
  items,
  shape = 'line',
}: {
  items: { name: string; color: string }[];
  shape?: 'line' | 'rect';
}) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
      {items.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            className={shape === 'line' ? 'h-0.5 w-3.5 rounded' : 'h-2.5 w-2.5 rounded-sm'}
            style={{ background: s.color }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Série temporal (uma escala só). `labels` = rótulo de cada ponto (dia). */
export function LineChart({
  series,
  labels,
  format = compact,
  height = 200,
  area = false,
  integer = true,
  testId,
}: {
  series: Series[];
  labels: string[];
  format?: (n: number) => string;
  height?: number;
  area?: boolean;
  /** Contagens: ticks inteiros. */
  integer?: boolean;
  testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 12, t: 10, b: 22 };
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1]!;
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 80))));
  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={series.map((s) => s.name).join(', ')}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - pad.l) / (width - pad.l - pad.r)) * (n - 1));
          setHover(Math.min(n - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="#ece8df" />
            <text
              x={pad.l - 6}
              y={y(t) + 3.5}
              textAnchor="end"
              className="fill-gray-400 font-mono text-[10px]"
            >
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map(
          (l, i) =>
            i % every === 0 && (
              <text
                key={l}
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                className="fill-gray-400 font-mono text-[10px]"
              >
                {l}
              </text>
            ),
        )}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
          return (
            <g key={s.name}>
              {area && n > 1 && (
                <path d={`${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} opacity={0.1} />
              )}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {n > 0 && (
                <circle
                  cx={x(n - 1)}
                  cy={y(s.values[n - 1] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="#a49d8f" />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4}
                fill={s.color}
                stroke="#fff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-gray-900/10 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(x(hover) + 12, width - 160) }}
        >
          <p className="mb-1 font-mono text-[10px] text-gray-500">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.name} className="flex items-center gap-2">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              <b className="tabular font-semibold text-ink">{format(s.values[hover] ?? 0)}</b>
              <span className="text-gray-500">{s.name}</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-start justify-between gap-3">
        <Legend items={series} />
        <DataTable
          head={['', ...series.map((s) => s.name)]}
          rows={labels.map((l, i) => [l, ...series.map((s) => format(s.values[i] ?? 0))])}
        />
      </div>
    </div>
  );
}

/** Tabela alternativa ao gráfico (acessibilidade; valores sem depender de hover). */
export function DataTable({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <details className="ml-auto text-xs">
      <summary className="font-mono text-[11px] text-gray-500 hover:text-ink">tabela</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded border border-gray-900/10 bg-white">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              {head.map((h, i) => (
                <th key={i} className="px-2 py-1 font-medium text-gray-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-900/[0.05]">
                {r.map((c, j) => (
                  <td key={j} className="tabular px-2 py-1 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Ranking horizontal (páginas, eventos, elementos): rótulo, barra fina e valor no fim. */
export function BarList({
  items,
  format = (n: number) => n.toLocaleString('pt-BR'),
  color = SERIES[0]!,
  empty = 'Sem dados no período.',
  onSelect,
}: {
  items: { label: ReactNode; value: number; key: string; hint?: ReactNode }[];
  format?: (n: number) => string;
  color?: string;
  empty?: string;
  onSelect?(key: string): void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-gray-400">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(it.key)}
            className="group block w-full text-left disabled:cursor-default"
            title={typeof it.label === 'string' ? it.label : undefined}
          >
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-gray-700 group-enabled:group-hover:text-ink">
                {it.label}
              </span>
              <span className="tabular shrink-0 font-mono text-xs text-gray-600">
                {format(it.value)}
                {it.hint && <span className="ml-1.5 text-gray-400">{it.hint}</span>}
              </span>
            </span>
            <span className="mt-1 block h-1.5 rounded-sm bg-gray-100">
              <span
                className="block h-full rounded-sm"
                style={{ width: `${(it.value / max) * 100}%`, background: color }}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Mini tendência (de-ênfase), sem eixos. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const d = values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${(i / Math.max(1, values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`,
    )
    .join('');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="#a49d8f" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
