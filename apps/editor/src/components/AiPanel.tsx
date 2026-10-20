import { Sparkles } from 'lucide-react';
import { changeToDraft, AI_PROMPT_MAX, type Operation, type PageSnapshot } from '@abtest/shared';
import { useEffect, useState } from 'react';
import { aiVariation, type AiVariation } from '../api';
import { describeOperation } from '../describe';
import { Button, inputCls } from '../ui';

/** Proposta da IA em pré-visualização: aplicada no iframe, ainda fora da variação. */
export interface AiPreview extends Omit<AiVariation, 'changes'> {
  ops: Operation[];
}

/**
 * Ideia → teste (18.2): o que a tela de ideias deixa para o editor do teste recém-criado. Fica na sessão do
 * navegador (só a próxima abertura daquele teste usa; recarregar não gera de novo).
 */
export interface IdeaSeed {
  title: string;
  /** Mudança sugerida pela ideia, vira o pedido da variação por texto. */
  change: string;
  /** Há IA configurada: gera e pré-visualiza assim que o site conectar. */
  auto: boolean;
  /** A meta não casou com nenhuma da conta e foi criada como evento customizado. */
  goalCreated?: boolean;
  /** Já gerou automaticamente (no editor, não guardado). */
  used?: boolean;
}
const seedKey = (expId: string) => `abt:idea-seed:${expId}`;
export function putIdeaSeed(expId: string, seed: IdeaSeed) {
  try {
    sessionStorage.setItem(seedKey(expId), JSON.stringify(seed));
  } catch {
    // Sem sessionStorage: o teste abre sem a sugestão.
  }
}
/** Lê e apaga (uma vez só). */
export function takeIdeaSeed(expId: string): IdeaSeed | null {
  try {
    const raw = sessionStorage.getItem(seedKey(expId));
    sessionStorage.removeItem(seedKey(expId));
    return raw ? (JSON.parse(raw) as IdeaSeed) : null;
  } catch {
    return null;
  }
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
  /** Vindo de uma ideia: pedido já preenchido e, com IA, gerado automaticamente uma vez. */
  seed?: IdeaSeed | null;
  /** A geração automática da ideia já foi disparada (não repetir ao voltar para a aba). */
  onSeedUsed?(): void;
}

/** Variação por texto: pedido → alterações propostas pela IA → pré-visualizar → aplicar ou descartar. */
export function AiPanel({
  blocked,
  preview,
  snapshot,
  base,
  onPreview,
  onApply,
  onHighlight,
  seed,
  onSeedUsed,
}: Props) {
  const [prompt, setPrompt] = useState(() => seed?.change.slice(0, AI_PROMPT_MAX) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (loading || !prompt.trim() || blocked) return;
    setLoading(true);
    setError(null);
    onPreview(null);
    try {
      let snap = await snapshot();
      // Logo depois de conectar (geração automática da ideia) a SPA pode ainda não ter renderizado: espera um pouco.
      for (let i = 0; !snap.elements.length && i < 10; i++) {
        await new Promise((ok) => setTimeout(ok, 300));
        snap = await snapshot();
      }
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

  // Ideia com IA: gera assim que o site conectar (blocked some), uma vez só.
  const autoRun = !!seed?.auto && !seed.used && !blocked;
  useEffect(() => {
    if (!autoRun) return;
    onSeedUsed?.();
    void generate();
    // Só quando passa a poder gerar; `generate` muda a cada render.
  }, [autoRun]);

  return (
    <div className="space-y-3 p-3 text-sm" data-testid="ai-panel">
      {seed && (
        <div className="rounded-md bg-lime-soft/60 px-3 py-2 text-xs text-gray-700" data-testid="ai-seed">
          <p>
            Teste criado da ideia <strong>{seed.title}</strong>: nome, página, hipótese e meta já estão em
            Configurações.
            {seed.goalCreated &&
              ' A meta virou um evento customizado com o nome dela: confira em Configurações se o site dispara esse evento.'}
          </p>
          {!seed.auto && (
            <p className="mt-1 text-gray-500">
              A IA não está configurada nesta instalação: use a mudança sugerida abaixo como guia e faça as
              alterações clicando nos elementos do site.
            </p>
          )}
        </div>
      )}
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
