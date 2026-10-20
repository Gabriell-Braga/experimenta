import { ArrowDown, ArrowUp, GitCompareArrows, Trash2, TriangleAlert } from 'lucide-react';
import type { ApplyResult, Operation } from '@abtest/shared';
import type { Conflict } from '../api';
import { selectorFragility } from '@abtest/selector';
import { describeOperation } from '../describe';

interface Props {
  operations: Operation[];
  result: ApplyResult | null;
  /** Outros experimentos que alteram os mesmos elementos (versão salva). */
  conflicts?: Conflict[];
  onHighlight(selector: string | null): void;
  onSelect(selector: string): void;
  onRemove(id: string): void;
  onMove(id: string, to: number): void;
}

export function ChangesPanel({
  operations,
  result,
  conflicts = [],
  onHighlight,
  onSelect,
  onRemove,
  onMove,
}: Props) {
  if (!operations.length)
    return <p className="p-3 text-sm text-gray-500">Nenhuma alteração nesta variação ainda.</p>;
  const failed = new Set(result?.failed ?? []);
  const healed = new Map(
    (result?.applied ?? []).filter((a) => a.via !== 'primary').map((a) => [a.id, a.via]),
  );
  const conflictsOf = (selector: string) => conflicts.filter((c) => c.selectors.includes(selector));
  return (
    <ol className="divide-y divide-gray-100" data-testid="changes">
      {conflicts.length > 0 && (
        <li className="bg-orange-50 px-3 py-2 text-xs text-orange-900" data-testid="conflicts">
          <GitCompareArrows size={13} className="mr-1 inline align-[-2px]" aria-hidden="true" />
          Conflito: {conflicts.map((c) => `${c.name} (${c.status})`).join(', ')} também altera(m) elementos
          desta página.
        </li>
      )}
      {operations.map((op, i) => (
        <li
          key={op.id}
          data-testid="change"
          data-status={failed.has(op.id) ? 'failed' : healed.has(op.id) ? 'healed' : 'ok'}
          className={`group flex items-start gap-2 px-3 py-2 text-sm ${failed.has(op.id) ? 'bg-red-50' : ''}`}
          onMouseEnter={() => onHighlight(op.target.selector)}
          onMouseLeave={() => onHighlight(null)}
        >
          <span className="mt-0.5 w-5 shrink-0 text-xs text-gray-400">{i + 1}</span>
          <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(op.target.selector)}>
            <span className="block truncate" data-testid="change-desc">
              {describeOperation(op)}
            </span>
            <code className="block truncate text-xs text-gray-500">
              {selectorFragility(op.target.selector) === 'high' && (
                <span
                  className="text-yellow-700"
                  title="Seletor frágil: depende de posição ou de classes geradas"
                  data-testid="fragile"
                >
                  <TriangleAlert size={12} className="inline align-[-1px]" aria-hidden="true" />{' '}
                </span>
              )}
              {op.target.selector}
            </code>
            {conflictsOf(op.target.selector).length > 0 && (
              <span className="block text-xs text-orange-800" data-testid="change-conflict">
                <GitCompareArrows size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                também alterado por{' '}
                {conflictsOf(op.target.selector)
                  .map((c) => c.name)
                  .join(', ')}
              </span>
            )}
            {failed.has(op.id) && (
              <span className="text-xs text-red-700">
                <TriangleAlert size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                elemento não encontrado nesta página
              </span>
            )}
            {healed.has(op.id) && (
              <span className="text-xs text-yellow-700">
                <TriangleAlert size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                seletor curado ({healed.get(op.id) === 'fingerprint' ? 'impressão digital' : 'alternativo'}),
                revise
              </span>
            )}
          </button>
          <span className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
            <button
              disabled={i === 0}
              onClick={() => onMove(op.id, i - 1)}
              aria-label="Subir"
              className="px-1 disabled:opacity-30"
            >
              <ArrowUp size={14} />
            </button>
            <button
              disabled={i === operations.length - 1}
              onClick={() => onMove(op.id, i + 1)}
              aria-label="Descer"
              className="px-1 disabled:opacity-30"
            >
              <ArrowDown size={14} />
            </button>
            <button
              onClick={() => onRemove(op.id)}
              aria-label="Excluir"
              data-testid="change-remove"
              className="px-1 text-red-600"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
