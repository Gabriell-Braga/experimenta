import Editor, { loader } from '@monaco-editor/react';
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

export default function CodePanel({ css, js, runJS, onCSS, onJS, onRunJS }: Props) {
  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <section data-testid="code-css">
        <h3 className="mb-1 font-semibold">CSS da variação</h3>
        <div className="h-48 overflow-hidden rounded border">
          <Editor language="css" value={css} onChange={(v) => onCSS(v ?? '')} options={OPTIONS} />
        </div>
      </section>
      <section data-testid="code-js">
        <h3 className="mb-1 font-semibold">JavaScript da variação</h3>
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
    </div>
  );
}
