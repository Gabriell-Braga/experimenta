import { Sparkles } from 'lucide-react';
import { changeToDraft, AI_PROMPT_MAX, type Operation, type PageSnapshot } from '@abtest/shared';
import { useState } from 'react';
import { aiVariation, type AiVariation } from '../api';
import { describeOperation } from '../describe';
import { Button, inputCls } from '../ui';

/** Proposta da IA em pré-visualização: aplicada no iframe, ainda fora da variação. */
export interface AiPreview extends Omit<AiVariation, 'changes'> {
  ops: Operation[];
}

interface Props {
  /** Por que não dá para gerar agora (sem conexão, página fora do funil...). */
  blocked?: string;
  preview: AiPreview | null;
  snapshot(): Promise<PageSnapshot>;
  /** Ordem a partir da qual as propostas entram (depois das alterações da página). */
  base: number;
  onPreview(p: AiPreview | null): void;
  onApply(): void;
  onHighlight(selector: string | null): void;
}

/** Variação por texto: pedido → alterações propostas pela IA → pré-visualizar → aplicar ou descartar. */
export function AiPanel({ blocked, preview, snapshot, base, onPreview, onApply, onHighlight }: Props) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (loading || !prompt.trim() || blocked) return;
    setLoading(true);
    setError(null);
    onPreview(null);
    try {
      const snap = await snapshot();
      const { changes, ...r } = await aiVariation(prompt.trim(), {
        url: snap.url,
        title: snap.title,
        elements: snap.elements,
      });
      // ref que sumiu entre o resumo e a resposta (página re-renderizou) não vira alteração.
      const drafts = changes.map((c) => changeToDraft(c, snap.targets)).filter((d) => d !== null);
      onPreview({
        ...r,
        skipped: r.skipped + changes.length - drafts.length,
        ops: drafts.map((d, i) => ({ ...d, id: `ai_${i}`, order: base + i }) as Operation),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 p-3 text-sm" data-testid="ai-panel">
      <label className="block">
        <span className="mb-1 block font-medium text-gray-700">Descreva a variação</span>
        <textarea
          data-testid="ai-prompt"
          className={`${inputCls} min-h-24`}
          maxLength={AI_PROMPT_MAX}
          value={prompt}
          placeholder='Ex.: deixe o botão "Comprar" verde e troque o título por "Frete grátis hoje"'
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate();
          }}
        />
      </label>
      {blocked && <p className="text-xs text-amber-800">{blocked}</p>}
      <Button
        variant="primary"
        className="w-full"
        loading={loading}
        disabled={!prompt.trim() || !!blocked}
        onClick={generate}
        data-testid="ai-generate"
      >
        <Sparkles size={14} aria-hidden="true" /> Gerar alterações
      </Button>
      <p className="text-xs text-gray-500">
        A IA lê os elementos visíveis desta página e só propõe texto, estilo, alguns atributos, imagem, ordem
        e visibilidade; nunca HTML ou JavaScript. Nada entra na variação antes de você aplicar.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700" data-testid="ai-error">
          {error}
        </p>
      )}
      {preview && (
        <section className="rounded-md border border-brand-200 bg-brand-50/40" data-testid="ai-preview">
          <header className="border-b border-brand-200 px-3 py-2">
            <p className="font-medium text-gray-800">
              {preview.ops.length
                ? `Pré-visualização no site: ${preview.ops.length} alteraç${preview.ops.length === 1 ? 'ão' : 'ões'}`
                : 'Nenhuma alteração possível'}
            </p>
            {preview.message && (
              <p className="mt-0.5 text-xs text-gray-600" data-testid="ai-message">
                {preview.message}
              </p>
            )}
          </header>
          {preview.ops.length > 0 && (
            <ol className="divide-y divide-brand-100">
              {preview.ops.map((op) => (
                <li
                  key={op.id}
                  className="px-3 py-1.5"
                  onMouseEnter={() => onHighlight(op.target.selector)}
                  onMouseLeave={() => onHighlight(null)}
                >
                  <span className="block truncate" data-testid="ai-change">
                    {describeOperation(op)}
                  </span>
                  <code className="block truncate text-xs text-gray-500">{op.target.selector}</code>
                </li>
              ))}
            </ol>
          )}
          {preview.skipped > 0 && (
            <p className="px-3 py-1 text-xs text-amber-800">
              {preview.skipped} sugest{preview.skipped === 1 ? 'ão ignorada' : 'ões ignoradas'} (elemento
              inexistente ou alteração não permitida).
            </p>
          )}
          <footer className="flex items-center gap-2 border-t border-brand-200 px-3 py-2">
            <span className="flex-1 truncate text-xs text-gray-400" title={preview.model}>
              {preview.source === 'claude' ? 'Claude' : preview.model}
            </span>
            <Button size="sm" variant="ghost" onClick={() => onPreview(null)} data-testid="ai-discard">
              Descartar
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!preview.ops.length}
              onClick={onApply}
              data-testid="ai-apply"
            >
              Aplicar
            </Button>
          </footer>
        </section>
      )}
    </div>
  );
}
