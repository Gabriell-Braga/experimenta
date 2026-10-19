import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, type Me } from '../api';
import { Button, Card, PageHeader } from '../ui';

function CodeBlock({ code, testId }: { code: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre
        className="overflow-x-auto rounded-md bg-ink p-4 pr-24 font-mono text-[12.5px] leading-relaxed text-[#e8e4da]"
        data-testid={testId}
      >
        {code}
      </pre>
      <Button
        size="sm"
        variant="inverseOutline"
        className="absolute top-2.5 right-2.5"
        onClick={() =>
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}

/** Comandos da fila `window.abq` aceitos pelo snippet (referência para o time do site). */
export const COMMANDS: [string, string][] = [
  ["abq.push(['track', 'compra', 199.9])", 'Evento customizado; com valor, conta como receita nas metas.'],
  ["abq.push(['adapter', (eventos) => { … }])", 'Recebe os lotes de eventos (envie para outro analytics).'],
];

export function InstallPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Instalação — Experimenta';
  }, []);
  const tag = `<script src="${API_URL}/cdn/${user.accountId}.js"></script>`;
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Instalação do snippet"
        description="Um único script, síncrono e pequeno, como primeiro item do <head>. Ele aplica os experimentos sem piscar, coleta os eventos e abre o editor visual quando você edita pelo app."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="1. Cole no <head> de todas as páginas">
          <CodeBlock code={tag} testId="snippet-tag" />
          <ul className="mt-4 space-y-2 text-sm text-gray-600">
            <li>
              <b className="text-ink">Primeiro script do head.</b> Assim as alterações entram antes da página
              aparecer (anti-flicker por elemento, sem esconder a página inteira).
            </li>
            <li>
              <b className="text-ink">SPA (React, Vue, Next…):</b> nada a fazer — mudanças de rota são
              detectadas automaticamente.
            </li>
            <li>
              <b className="text-ink">Modo QA:</b>{' '}
              <code className="font-mono text-xs">?ab_force=exp:variacao</code> força uma variação e mostra um
              selo na página.
            </li>
          </ul>
        </Card>
        <Card title="2. Conte o que importa (opcional)">
          <p className="text-sm text-gray-600">
            Pode enfileirar comandos antes do snippet carregar:{' '}
            <code className="font-mono text-xs">window.abq = window.abq || []</code>.
          </p>
          <dl className="mt-3 divide-y divide-gray-900/[0.06]">
            {COMMANDS.map(([code, what]) => (
              <div key={code} className="py-2.5">
                <dt className="font-mono text-[12px] text-ink">{code}</dt>
                <dd className="mt-0.5 text-xs text-gray-500">{what}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
