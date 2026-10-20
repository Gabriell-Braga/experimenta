import type { HeatmapSummary, RecordingSummary, ReportSummary, SurveySummary } from '@abtest/shared';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { aiSummary, type AiSummary as Result, type AiSummaryRequest } from '../api';
import { Button, timeAgo } from '../ui';

const SENTIMENT: Record<string, string> = {
  positivo: 'bg-lime-soft text-brand-900',
  negativo: 'bg-red-50 text-red-700',
  misto: 'bg-amber-50 text-amber-800',
  neutro: 'bg-gray-100 text-gray-700',
};

function List({ title, items, testid }: { title: string; items: string[]; testid: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="label-mono mb-1">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4" data-testid={testid}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

const CONFIDENCE: Record<string, string> = {
  alta: 'bg-lime-soft text-brand-900',
  média: 'bg-amber-50 text-amber-800',
  baixa: 'bg-red-50 text-red-700',
};

function Body({ r }: { r: Result }) {
  if (r.kind === 'report') {
    const s = r.summary as unknown as ReportSummary;
    return (
      <>
        <p className="font-medium text-ink" data-testid="ai-report-summary">
          {s.summary}
        </p>
        <p>
          <span className="label-mono block">O que significa para o negócio</span>
          <span data-testid="ai-report-business">{s.business}</span>
        </p>
        <p className="flex items-center gap-2">
          <span className="label-mono">Confiança</span>
          <span
            className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE[s.confidence] ?? ''}`}
            data-testid="ai-report-confidence"
          >
            {s.confidence}
          </span>
        </p>
        <List title="Ressalvas" items={s.caveats} testid="ai-report-caveats" />
        <div>
          <p className="label-mono mb-1">Próximo passo</p>
          <p data-testid="ai-report-next" data-action={s.next.action}>
            {s.next.text}
          </p>
          {s.next.idea && (
            <p
              className="mt-1 border-l-2 border-gray-200 pl-2 text-xs text-gray-600"
              data-testid="ai-report-idea"
            >
              <b className="text-ink">{s.next.idea.title}</b> · {s.next.idea.hypothesis}
            </p>
          )}
        </div>
      </>
    );
  }
  if (r.kind === 'recording') {
    const s = r.summary as unknown as RecordingSummary;
    return (
      <>
        <p>
          <span className="label-mono block">Objetivo provável</span>
          <span data-testid="ai-summary-goal">{s.goal}</span>
        </p>
        <List title="Passos" items={s.steps} testid="ai-summary-steps" />
        <p>
          <span className="label-mono block">Onde travou</span>
          <span data-testid="ai-summary-stuck">{s.stuck || 'Não travou.'}</span>
        </p>
        <List title="Sinais de frustração" items={s.frustration} testid="ai-summary-frustration" />
      </>
    );
  }
  if (r.kind === 'heatmap') {
    const s = r.summary as unknown as HeatmapSummary;
    return (
      <>
        <List title="Chama atenção" items={s.attention} testid="ai-summary-attention" />
        <List title="É ignorado" items={s.ignored} testid="ai-summary-ignored" />
        <List title="Sugestões de teste" items={s.suggestions} testid="ai-summary-suggestions" />
      </>
    );
  }
  const s = r.summary as unknown as SurveySummary;
  return (
    <>
      <p>
        <span
          className={`mr-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium ${SENTIMENT[s.sentiment] ?? ''}`}
          data-testid="ai-summary-sentiment"
        >
          {s.sentiment}
        </span>
        {s.overview}
      </p>
      <ol className="space-y-2" data-testid="ai-summary-themes">
        {s.themes.map((t, i) => (
          <li key={i} data-testid="ai-summary-theme">
            <p className="flex items-center gap-2">
              <span className="font-medium text-ink">{t.name}</span>
              <span className="tabular font-mono text-[11px] text-gray-500">
                {t.count} resposta{t.count === 1 ? '' : 's'}
              </span>
              <span className={`rounded-sm px-1.5 text-[11px] ${SENTIMENT[t.sentiment] ?? ''}`}>
                {t.sentiment}
              </span>
            </p>
            {t.examples.map((x, j) => (
              <p key={j} className="mt-0.5 border-l-2 border-gray-200 pl-2 text-xs text-gray-600">
                “{x}”
              </p>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Botão "Resumir com IA" e o resumo (gravação, mapa de calor, pesquisa ou relatório). A API guarda o resumo e só chama o
 * modelo de novo quando os dados mudam; com dado novo há menos de 1 h, mostra o guardado e oferece "Atualizar".
 */
export function AiSummaryCard({
  request,
  className = '',
  label = 'Resumir com IA',
  actions,
}: {
  /** Monta o pedido na hora (o mapa de calor lê o texto dos elementos na página). */
  request(): Promise<AiSummaryRequest> | AiSummaryRequest;
  className?: string;
  label?: string;
  /** Botões de ação a partir do resultado (ex.: próximo passo do relatório). */
  actions?: (r: Result) => ReactNode;
}) {
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (refresh = false) => {
    setError(null);
    try {
      setR(await aiSummary({ ...(await request()), ...(refresh ? { refresh } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className={`space-y-2 text-sm ${className}`} data-testid="ai-summary">
      {!r && (
        <Button size="sm" onClick={() => run()} data-testid="ai-summary-run">
          <Sparkles size={14} aria-hidden="true" /> {label}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-red-700"
          data-testid="ai-summary-error"
        >
          {error}
        </p>
      )}
      {r && (
        <div
          className="space-y-2.5 rounded-md border border-brand-200 bg-brand-50/40 p-3"
          data-testid="ai-summary-result"
        >
          <Body r={r} />
          {actions?.(r)}
          <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-brand-100 pt-2 text-[11px] text-gray-500">
            <span data-testid="ai-summary-source">
              {r.source === 'regras'
                ? r.kind === 'survey'
                  ? 'Por palavras-chave'
                  : 'Por regras'
                : `IA (${r.model ?? r.source})`}{' '}
              · {timeAgo(r.createdAt)}
            </span>
            {r.note && <span data-testid="ai-summary-note">{r.note}</span>}
            {r.stale && <span className="text-amber-800">Há dados novos desde este resumo.</span>}
            {(r.stale || r.source === 'regras') && (
              <Button size="sm" variant="ghost" onClick={() => run(true)} data-testid="ai-summary-refresh">
                <RefreshCw size={12} aria-hidden="true" /> Atualizar
              </Button>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}
