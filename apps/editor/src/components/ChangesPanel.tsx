import type { ApplyResult, Operation } from '@abtest/shared';
import { selectorFragility } from '@abtest/selector';
import { describeOperation } from '../describe';

interface Props {
  operations: Operation[];
  result: ApplyResult | null;
  onHighlight(selector: string | null): void;
  onSelect(selector: string): void;
  onRemove(id: string): void;
  onMove(id: string, to: number): void;
}

export function ChangesPanel({ operations, result, onHighlight, onSelect, onRemove, onMove }: Props) {
  if (!operations.length)
    return <p className="p-3 text-sm text-gray-500">Nenhuma alteração nesta variação ainda.</p>;
  const failed = new Set(result?.failed ?? []);
  const healed = new Map(
    (result?.applied ?? []).filter((a) => a.via !== 'primary').map((a) => [a.id, a.via]),
  );
  return (
    <ol className="divide-y divide-gray-100" data-testid="changes">
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
                  ⚠{' '}
                </span>
              )}
              {op.target.selector}
            </code>
            {failed.has(op.id) && (
              <span className="text-xs text-red-700">⚠ elemento não encontrado nesta página</span>
            )}
            {healed.has(op.id) && (
              <span className="text-xs text-yellow-700">
                ⚠ seletor curado ({healed.get(op.id) === 'fingerprint' ? 'impressão digital' : 'alternativo'})
                — revise
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
              ↑
            </button>
            <button
              disabled={i === operations.length - 1}
              onClick={() => onMove(op.id, i + 1)}
              aria-label="Descer"
              className="px-1 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={() => onRemove(op.id)}
              aria-label="Excluir"
              data-testid="change-remove"
              className="px-1 text-red-600"
            >
              ✕
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
