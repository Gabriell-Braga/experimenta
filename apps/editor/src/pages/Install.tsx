import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, type Me } from '../api';
import { Button, Card, PageHeader, useCopy } from '../ui';
import { ConsentCard } from './Privacy';

export function CodeBlock({ code, testId }: { code: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCopy();
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
          copy(code).then((ok) => {
            if (!ok) return;
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
  [
    "abq.push(['track', 'compra', 199.9, { sku: 'TN-1' }])",
    'Evento customizado (valor e propriedades opcionais). Com valor, conta como receita nas metas.',
  ],
  ["abq.push(['event', 'filtro_aplicado', { cor: 'azul' }])", 'Evento com propriedades, sem valor.'],
  [
    "abq.push(['identify', 'usuario-42', { plano: 'pro' }])",
    'Liga o visitante ao usuário logado (perfis e cross-device) e grava atributos.',
  ],
  ["abq.push(['set', { segmento: 'b2b' }])", 'Só atributos do visitante (segmentação e perfis).'],
  ["abq.push(['adapter', (eventos) => { … }])", 'Recebe os lotes de eventos (envie para outro analytics).'],
  [
    "abq.push(['consent', true | false])",
    'LGPD/GDPR: aceita ou recusa (recusar apaga os cookies do snippet). Ver Configurar → Privacidade.',
  ],
];

/** Tempo máximo com a página escondida na instalação assíncrona: depois disso ela aparece mesmo sem o snippet. */
const ASYNC_TIMEOUT_MS = 2500;

/**
 * Instalação assíncrona (D-099): o script não bloqueia a página; um estilo inline esconde o <body> até o snippet
 * rodar, dar erro ou passar de 2,5 s. O runtime não muda (o anti-flicker por elemento continua dentro dele).
 */
export const asyncTag = (src: string) => `<style id="abt-af">body{opacity:0!important}</style>
<script>
(function (d) {
  var done = function () { var s = d.getElementById('abt-af'); if (s) s.remove(); };
  setTimeout(done, ${ASYNC_TIMEOUT_MS});
  var s = d.createElement('script');
  s.src = '${src}';
  s.async = true;
  s.onload = s.onerror = done;
  d.head.appendChild(s);
})(document);
</script>`;

export function InstallPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Instalação · Experimenta';
  }, []);
  const [mode, setMode] = useState<'sync' | 'async'>('sync');
  const src = `${API_URL}/cdn/${user.accountId}.js`;
  const tag = mode === 'sync' ? `<script src="${src}"></script>` : asyncTag(src);
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Instalação do snippet"
        description="Um único script pequeno como primeiro item do <head>. Ele aplica os experimentos sem piscar, coleta os eventos e abre o editor visual quando você edita pelo app."
      />
      <div className="mt-6">
        <ConsentCard
          canEdit={user.role !== 'viewer'}
          title="0. Consentimento de cookies (escolha antes de instalar)"
        />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="1. Cole no <head> de todas as páginas">
          <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Forma de instalação">
            {(
              [
                ['sync', 'Síncrona (recomendada)'],
                ['async', 'Assíncrona com tempo limite'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={mode === k}
                onClick={() => setMode(k)}
                data-testid={`install-${k}`}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  mode === k
                    ? 'border-ink bg-ink text-white'
                    : 'border-gray-300 text-gray-700 hover:border-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <CodeBlock code={tag} testId="snippet-tag" />
          <ul className="mt-4 space-y-2 text-sm text-gray-600">
            {mode === 'sync' ? (
              <li>
                <b className="text-ink">Primeiro script do head.</b> Assim as alterações entram antes da
                página aparecer (anti-flicker por elemento, sem esconder a página inteira). O arquivo fica em
                cache por 5 min e, se o servidor demorar ou falhar, o navegador usa a cópia anterior.
              </li>
            ) : (
              <li>
                <b className="text-ink">Não bloqueia a página.</b> A página fica escondida até o snippet
                rodar, no máximo {ASYNC_TIMEOUT_MS / 1000} s; se ele demorar mais, a página aparece sem os
                testes naquela visita. Use quando o tempo de carregamento pesar mais que a chance de ver o
                original piscar.
              </li>
            )}
            <li>
              <b className="text-ink">SPA (React, Vue, Next…):</b> nada a fazer: mudanças de rota são
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
