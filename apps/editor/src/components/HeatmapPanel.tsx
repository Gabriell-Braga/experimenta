import type { HeatmapData, Variation } from '@abtest/shared';
import type { HeatmapFilters } from '../api';

interface Props {
  variations: Variation[];
  filters: HeatmapFilters;
  onFilters(f: HeatmapFilters): void;
  data: (HeatmapData & { page: string }) | null;
  /** Seletores sem elemento na página atual (layout mudou ou variação diferente). */
  missing: number;
  onHighlight(selector: string | null): void;
}

const input = 'w-full rounded border border-gray-300 px-2 py-1 text-sm';

export function HeatmapPanel({ variations, filters, onFilters, data, missing, onHighlight }: Props) {
  return (
    <div className="flex flex-col gap-3 p-3 text-sm" data-testid="heatmap-panel">
      <label className="flex flex-col gap-1">
        <span className="text-gray-600">Variação</span>
        <select
          className={input}
          data-testid="heatmap-variation"
          value={filters.variationId ?? ''}
          onChange={(e) => onFilters({ ...filters, variationId: e.target.value || undefined })}
        >
          <option value="">Todos os visitantes</option>
          {variations.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-gray-600">Dispositivo</span>
        <select
          className={input}
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
          <p data-testid="heatmap-summary">
            <b>{data.clicks.total}</b> cliques · <b>{data.scroll.pageviews}</b> páginas vistas
          </p>
          {missing > 0 && (
            <p className="text-xs text-yellow-800">
              {missing} elemento(s) clicado(s) não existem nesta página agora (layout ou variação diferente).
            </p>
          )}
          <ol className="divide-y divide-gray-100 rounded border border-gray-100">
            {data.clicks.elements.slice(0, 15).map((e) => (
              <li
                key={e.selector}
                className="flex justify-between gap-2 px-2 py-1"
                onMouseEnter={() => onHighlight(e.selector)}
                onMouseLeave={() => onHighlight(null)}
              >
                <code className="truncate text-xs">{e.selector}</code>
                <span className="shrink-0 text-xs text-gray-600">
                  {e.count} ({Math.round((e.count / (data.clicks.total || 1)) * 100)}%)
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-gray-500">Dados de visitantes reais do site publicado (amostrados).</p>
        </>
      )}
    </div>
  );
}
