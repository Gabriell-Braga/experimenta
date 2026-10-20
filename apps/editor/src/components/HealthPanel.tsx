import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import type { Operation, Variation } from '@abtest/shared';
import { getHealth } from '../api';
import { describeOperation } from '../describe';
import { Skeleton, useLoad } from '../ui';

interface Props {
  experimentId: string;
  variation: Variation;
  /** Troca o seletor principal pelo curado (o antigo vira alternativo). */
  onAdopt(op: Operation, selector: string): void;
  onHighlight(selector: string | null): void;
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : 'n/d');

/** Saúde dos seletores em produção (eventos selector_failed / selector_healed enviados pelo snippet). */
export function HealthPanel({ experimentId, variation, onAdopt, onHighlight }: Props) {
  const { data: health, error, reload } = useLoad(() => getHealth(experimentId), [experimentId]);

  if (error) return <p className="p-3 text-sm text-red-600">{error.message}</p>;
  if (!health)
    return (
      <div className="space-y-2 p-3" role="status" aria-label="Carregando" data-testid="loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );

  const exposures = health.exposures[variation.id] ?? 0;
  const byOp = new Map(
    health.operations.filter((o) => o.variationId === variation.id).map((o) => [o.operationId, o]),
  );
  const problems = variation.operations.filter((op) => byOp.has(op.id));

  return (
    <div className="flex flex-col text-sm" data-testid="health">
      <div className="flex items-center justify-between border-b border-gray-100 p-3">
        <span>
          <b>{exposures}</b> exposições de {variation.name} ·{' '}
          <span className={problems.length ? 'text-red-700' : 'text-brand-700'} data-testid="health-summary">
            {problems.length ? `${problems.length} alteração(ões) com problema` : 'todas as alterações OK'}
          </span>
        </span>
        <button onClick={reload} className="text-xs text-orange-600" data-testid="health-refresh">
          Atualizar
        </button>
      </div>
      <ul className="divide-y divide-gray-100">
        {variation.operations.map((op) => {
          const h = byOp.get(op.id);
          return (
            <li
              key={op.id}
              className="px-3 py-2"
              data-testid="health-op"
              data-state={!h ? 'ok' : h.failed ? 'failed' : 'healed'}
              onMouseEnter={() => onHighlight(op.target.selector)}
              onMouseLeave={() => onHighlight(null)}
            >
              <span className="block truncate">{describeOperation(op)}</span>
              <code className="block truncate text-xs text-gray-500">{op.target.selector}</code>
              {!h && (
                <span className="text-xs text-brand-700">
                  <CircleCheck size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" /> sem falhas
                  registradas
                </span>
              )}
              {h && h.failed > 0 && (
                <span className="block text-xs text-red-700">
                  <CircleX size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                  não encontrou o elemento {h.failed}× ({pct(h.failed, exposures)} das exposições)
                </span>
              )}
              {h?.lastHealed && (
                <span className="block text-xs text-yellow-800">
                  <TriangleAlert size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                  curado {h.healed}× via{' '}
                  {h.lastHealed.via === 'fingerprint' ? 'impressão digital' : 'seletor alternativo'}:{' '}
                  <code>{h.lastHealed.healedSelector}</code>
                  {h.lastHealed.healedSelector !== op.target.selector && (
                    <button
                      className="ml-1 underline"
                      data-testid="adopt"
                      onClick={() => onAdopt(op, h.lastHealed!.healedSelector)}
                    >
                      adotar este seletor
                    </button>
                  )}
                </span>
              )}
              {h && (
                <span className="block text-[11px] text-gray-400">
                  último em {new Date(h.lastSeen).toLocaleString('pt-BR')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="p-3 text-xs text-gray-500">
        Dados do site publicado (eventos do snippet). Depois de adotar um seletor, salve e publique.
      </p>
    </div>
  );
}
