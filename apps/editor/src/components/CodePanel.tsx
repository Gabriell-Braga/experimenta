import Editor, { loader } from '@monaco-editor/react';
import { Maximize2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco empacotado localmente (sem CDN): o editor funciona offline e sem depender de terceiros.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'css') return new cssWorker();
    if (label === 'javascript' || label === 'typescript') return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

interface Props {
  css: string;
  js: string;
  runJS: boolean;
  onCSS(v: string): void;
  onJS(v: string): void;
  onRunJS(v: boolean): void;
}

const OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  scrollBeyondLastLine: false,
  automaticLayout: true,
} as const;

/** Editor grande (quase tela cheia) para ler/escrever o código com conforto. Esc fecha. */
function BigEditor({
  title,
  language,
  value,
  onChange,
  onClose,
}: {
  title: string;
  language: string;
  value: string;
  onChange(v: string): void;
  onClose(): void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/40 p-4" data-testid="code-big">
      <div className="flex h-[85vh] w-[min(72rem,100%)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <Editor
            language={language}
            value={value}
            onChange={(v) => onChange(v ?? '')}
            options={{ ...OPTIONS, fontSize: 14, minimap: { enabled: true } }}
          />
        </div>
      </div>
    </div>
  );
}

function Title({ children, onExpand, testId }: { children: string; onExpand(): void; testId: string }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <h3 className="font-semibold">{children}</h3>
      <button
        onClick={onExpand}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
        data-testid={testId}
      >
        <Maximize2 size={12} aria-hidden="true" /> Expandir
      </button>
    </div>
  );
}

export default function CodePanel({ css, js, runJS, onCSS, onJS, onRunJS }: Props) {
  const [big, setBig] = useState<'css' | 'js' | null>(null);
  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <section data-testid="code-css">
        <Title onExpand={() => setBig('css')} testId="expand-css">
          CSS da variação
        </Title>
        <div className="h-48 overflow-hidden rounded border">
          <Editor language="css" value={css} onChange={(v) => onCSS(v ?? '')} options={OPTIONS} />
        </div>
      </section>
      <section data-testid="code-js">
        <Title onExpand={() => setBig('js')} testId="expand-js">
          JavaScript da variação
        </Title>
        <div className="h-48 overflow-hidden rounded border">
          <Editor language="javascript" value={js} onChange={(v) => onJS(v ?? '')} options={OPTIONS} />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={runJS}
            onChange={(e) => onRunJS(e.target.checked)}
            data-testid="run-js"
          />
          Executar o JS no editor (roda na página real; só publique JS de origem confiável)
        </label>
      </section>
      {big && (
        <BigEditor
          title={big === 'css' ? 'CSS da variação' : 'JavaScript da variação'}
          language={big === 'css' ? 'css' : 'javascript'}
          value={big === 'css' ? css : js}
          onChange={big === 'css' ? onCSS : onJS}
          onClose={() => setBig(null)}
        />
      )}
    </div>
  );
}
