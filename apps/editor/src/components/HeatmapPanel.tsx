import type { HeatmapData, HeatmapMode, Variation } from '@abtest/shared';
import type { HeatmapFilters } from '../api';
import { fmt, selectCls } from '../ui';

export type HeatmapResult = Omit<HeatmapData, 'mode'> & { page: string };

interface Props {
  /** Experimentos para escolher (visualizador do módulo); no editor o experimento é o aberto. */
  experiments?: { id: string; name: string }[];
  /** Variações para filtrar (do experimento aberto no editor ou do escolhido em `experiments`). */
  variations?: Variation[];
  filters: HeatmapFilters;
  onFilters(f: HeatmapFilters): void;
  mode: HeatmapMode;
  onMode(m: HeatmapMode): void;
  data: HeatmapResult | null;
  /** Seletores sem elemento na página atual (layout mudou ou variação diferente). */
  missing: number;
  onHighlight(selector: string | null): void;
}

export const HEATMAP_MODES: [HeatmapMode, string, string][] = [
  ['heat', 'Calor', 'Onde os visitantes clicam (intensidade), contagem por elemento e alcance do scroll'],
  ['click', 'Cliques', 'Contagem e % de cliques em cada elemento clicado'],
  ['scroll', 'Scroll', 'Quantos % dos visitantes chegaram a cada trecho da página'],
  ['move', 'Movimento', 'Por onde o mouse passa: onde a atenção se concentra'],
  ['frustration', 'Frustração', 'Rage clicks (cliques repetidos) e dead clicks (cliques sem reação)'],
];

export function HeatmapPanel({
  experiments,
  variations,
  filters,
  onFilters,
  mode,
  onMode,
  data,
  missing,
  onHighlight,
}: Props) {
  const rows =
    mode === 'frustration'
      ? (data?.frustration ?? []).map((f) => ({
          selector: f.selector,
          label: `${f.rage} rage · ${f.dead} dead`,
        }))
      : (data?.clicks.elements ?? []).map((e) => ({
          selector: e.selector,
          label: `${e.count} (${Math.round((e.count / (data?.clicks.total || 1)) * 100)}%)`,
        }));
  const rage = data?.frustration.reduce((s, f) => s + f.rage, 0) ?? 0;
  const dead = data?.frustration.reduce((s, f) => s + f.dead, 0) ?? 0;
  return (
    <div className="flex flex-col gap-4 p-3 text-sm" data-testid="heatmap-panel">
      <div>
        <p className="label-mono mb-1.5">Visualização</p>
        <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Tipo de mapa">
          {HEATMAP_MODES.map(([m, label, help]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              title={help}
              onClick={() => onMode(m)}
              data-testid={`heatmap-mode-${m}`}
              className={`rounded-md border px-2 py-1.5 text-xs ${mode === m ? 'border-ink bg-ink text-white' : 'border-gray-900/10 text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{HEATMAP_MODES.find((x) => x[0] === mode)?.[2]}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label-mono">Período</span>
        <select
          className={selectCls}
          data-testid="heatmap-days"
          value={filters.days ?? ''}
          onChange={(e) => onFilters({ ...filters, days: e.target.value || undefined })}
        >
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="">Todo o histórico</option>
        </select>
      </label>
      {experiments && (
        <label className="flex flex-col gap-1">
          <span className="label-mono">Experimento</span>
          <select
            className={selectCls}
            data-testid="heatmap-experiment"
            value={filters.experimentId ?? ''}
            onChange={(e) =>
              onFilters({ ...filters, experimentId: e.target.value || undefined, variationId: undefined })
            }
          >
            <option value="">Todos os visitantes</option>
            {experiments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {variations && (
        <label className="flex flex-col gap-1">
          <span className="label-mono">Variação</span>
          <select
            className={selectCls}
            data-testid="heatmap-variation"
            value={filters.variationId ?? ''}
            onChange={(e) => onFilters({ ...filters, variationId: e.target.value || undefined })}
          >
            <option value="">{experiments ? 'Todas as variações' : 'Todos os visitantes'}</option>
            {variations.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="label-mono">Dispositivo</span>
        <select
          className={selectCls}
          data-testid="heatmap-device"
          value={filters.device ?? ''}
          onChange={(e) =>
            onFilters({ ...filters, device: (e.target.value || undefined) as HeatmapFilters['device'] })
          }
        >
          <option value="">Todos</option>
          <option value="desktop">Desktop</option>
          <option value="tablet">Tablet</option>
          <option value="mobile">Celular</option>
        </select>
      </label>
      {!data ? (
        <p className="text-gray-500">Carregando…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2" data-testid="heatmap-summary">
            {(
              [
                ['Cliques', `${fmt.int(data.clicks.total)} cliques`],
                ['Páginas vistas', fmt.int(data.scroll.pageviews)],
                ['Rage clicks', fmt.int(rage)],
                ['Dead clicks', fmt.int(dead)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-md border border-gray-900/10 px-2.5 py-1.5">
                <dt className="label-mono">{k}</dt>
                <dd className="tabular mt-0.5 font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {missing > 0 && (
            <p className="text-xs text-amber-800">
              {missing} elemento(s) clicados não aparecem na tela agora (escondidos neste layout, em outro
              slide do carrossel, ainda não carregados ou de outra variação). Os visíveis estão desenhados.
            </p>
          )}
          {mode === 'scroll' ? (
            <ol className="space-y-1" data-testid="scroll-table">
              {data.scroll.reached.map((r) => (
                <li key={r.depth} className="flex items-center gap-2 text-xs">
                  <span className="tabular w-10 font-mono text-gray-500">{r.depth}%</span>
                  <span className="h-1.5 flex-1 rounded-full bg-gray-100">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${r.pct}%` }} />
                  </span>
                  <span className="tabular w-12 text-right font-mono">{r.pct}%</span>
                </li>
              ))}
            </ol>
          ) : mode === 'move' ? (
            <p className="text-xs text-gray-500">{fmt.int(data.moves.length)} pontos de movimento.</p>
          ) : (
            <div>
              <p className="label-mono mb-1.5">
                {mode === 'frustration' ? 'Elementos com frustração' : 'Lista de elementos'}
              </p>
              {rows.length ? (
                <ol
                  className="divide-y divide-gray-900/[0.06] rounded-md border border-gray-900/10"
                  data-testid="element-list"
                >
                  {rows.slice(0, 20).map((e) => (
                    <li
                      key={e.selector}
                      className="flex justify-between gap-2 px-2 py-1.5 hover:bg-lime-soft/50"
                      onMouseEnter={() => onHighlight(e.selector)}
                      onMouseLeave={() => onHighlight(null)}
                    >
                      <code className="truncate font-mono text-[11px]">{e.selector}</code>
                      <span className="tabular shrink-0 font-mono text-[11px] text-gray-600">{e.label}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-gray-400">Nada registrado nesta página.</p>
              )}
            </div>
          )}
          <p className="text-xs text-gray-500">Dados de visitantes reais do site publicado (amostrados).</p>
        </>
      )}
    </div>
  );
}
