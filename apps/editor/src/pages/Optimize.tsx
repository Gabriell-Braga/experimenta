import { Check, Copy, Plane, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ideas, type Ideas, type Me, type SavedIdea } from '../api';
import { navigate } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  PageHeader,
  Segmented,
  timeAgo,
  useCopy,
  useLoad,
  useToast,
} from '../ui';
import { PERIODS, type Period } from './Events';

const LEVEL: Record<string, string> = {
  alto: 'bg-brand-50 text-brand-700',
  médio: 'bg-gray-100 text-gray-700',
  baixo: 'bg-gray-50 text-gray-500',
};

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase ${LEVEL[value] ?? ''}`}
    >
      {label} {value}
    </span>
  );
}

const SOURCE: Record<string, (model?: string) => string> = {
  claude: (m) => `por Claude (${m})`,
  modelo: (m) => `por IA (${m})`,
  regras: () => 'por regras · sem modelo de IA configurado',
};

function IdeaCard({
  i,
  n,
  canEdit,
  onChange,
}: {
  i: SavedIdea;
  n: number;
  canEdit: boolean;
  onChange(p: Promise<Ideas>): Promise<unknown>;
}) {
  const copy = useCopy();
  const done = !!i.doneAt;
  return (
    <li
      className={`rounded-lg border border-gray-900/10 bg-white p-4 ${done ? 'opacity-60' : ''}`}
      data-testid="idea"
      data-done={done || undefined}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs text-gray-400">{String(n + 1).padStart(2, '0')}</span>
        <h3 className={`font-display text-lg leading-tight text-ink ${done ? 'line-through' : ''}`}>
          {i.title}
        </h3>
        <span className="ml-auto flex gap-1">
          <Tag label="impacto" value={i.impact} />
          <Tag label="esforço" value={i.effort} />
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{i.hypothesis}</p>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="label-mono">Mudança</dt>
        <dd className="text-gray-700">{i.change}</dd>
        <dt className="label-mono">Página</dt>
        <dd className="font-mono text-gray-700">{i.page}</dd>
        <dt className="label-mono">Meta</dt>
        <dd className="text-gray-700">{i.metric}</dd>
        <dt className="label-mono">Por quê</dt>
        <dd className="text-gray-500">{i.basedOn}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!done && (
          <Button size="sm" onClick={() => navigate('tests')}>
            Criar teste
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(ideas.done(i.id, !done))}
            data-testid="idea-done"
          >
            {done ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            {done ? 'Reabrir' : 'Marcar como executada'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            copy(
              `${i.title}\nHipótese: ${i.hypothesis}\nMudança: ${i.change}\nMeta: ${i.metric}`,
              'Ideia copiada.',
            )
          }
        >
          <Copy size={14} aria-hidden="true" /> Copiar
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-gray-500"
            onClick={() => onChange(ideas.remove(i.id))}
            data-testid="idea-remove"
          >
            <Trash2 size={14} aria-hidden="true" /> Descartar
          </Button>
        )}
        <span className="label-mono w-full text-[10px] text-gray-400">
          {SOURCE[i.source]?.(i.model)} · {timeAgo(i.createdAt)}
          {i.doneAt ? ` · executada ${timeAgo(i.doneAt)}` : ''}
        </span>
      </div>
    </li>
  );
}

export function OptimizePage({ user }: { user: Me }) {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const { data, setData } = useLoad(ideas.get, []);
  const running = data?.status === 'running';
  useEffect(() => {
    document.title = 'Otimização por IA · Experimenta';
  }, []);
  // A geração roda na API; aqui só acompanha. Sair da tela não interrompe nada.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (wasRunning.current && !running) {
      if (data.status === 'error') toast('error', data.error ?? 'A geração falhou.');
      else toast('success', 'Ideias prontas.');
    }
    wasRunning.current = running;
    if (!running) return;
    const t = setTimeout(() => ideas.get().then(setData, () => {}), 2500);
    return () => clearTimeout(t);
  }, [data, running, setData, toast]);
  const change = (p: Promise<Ideas>) => p.then(setData, (e: Error) => toast('error', e.message));
  const canEdit = user.role !== 'viewer';
  const open = data?.ideas.filter((i) => !i.doneAt) ?? [];
  const done = data?.ideas.filter((i) => i.doneAt) ?? [];
  const last = !data
    ? ''
    : running
      ? 'Gerando em segundo plano. Pode sair da tela: as ideias ficam salvas aqui.'
      : data.status === 'error'
        ? `A última geração falhou: ${data.error ?? ''}`
        : data.source
          ? (data.notice ?? `Última geração ${SOURCE[data.source]?.(data.model) ?? ''}`) +
            (data.finishedAt ? ` · ${timeAgo(data.finishedAt)}` : '')
          : '';
  return (
    <>
      <PageHeader
        eyebrow="Testes · IA"
        title="Otimização por IA"
        description="Ideias de teste priorizadas a partir do que o painel encontrou (frustração, abandono, funis, testes no ar), e um piloto automático que cuida da alocação por você."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {canEdit && (
              <Button
                variant="primary"
                loading={running}
                disabled={!data}
                onClick={() => change(ideas.generate(Number(days)))}
                data-testid="ideas-run"
              >
                <Sparkles size={16} aria-hidden="true" />{' '}
                {running ? 'Gerando…' : data?.ideas.length ? 'Gerar mais ideias' : 'Gerar ideias'}
              </Button>
            )}
            <span className="label-mono" data-testid="ideas-source">
              {last}
            </span>
            {canEdit && !!data?.ideas.length && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  confirm('Limpar todas as ideias guardadas (abertas e executadas)?')
                    ? change(ideas.clear())
                    : undefined
                }
                data-testid="ideas-clear"
              >
                <Trash2 size={14} aria-hidden="true" /> Limpar tudo
              </Button>
            )}
          </div>
          {!data || (running && !data.ideas.length) ? (
            <LoadingBlock rows={4} />
          ) : !data.ideas.length ? (
            <EmptyState icon={<Sparkles size={20} aria-hidden="true" />} title="Pronto para sugerir">
              {data.status === 'done'
                ? 'Ainda não há achados suficientes no período. Colete mais dados ou aumente o período.'
                : 'As ideias usam só números agregados do período (nenhum dado de visitante sai da conta) e ficam guardadas aqui até você executar ou descartar.'}
            </EmptyState>
          ) : (
            <>
              {open.length > 0 && (
                <ol className="space-y-3" data-testid="ideas">
                  {open.map((i, n) => (
                    <IdeaCard key={i.id} i={i} n={n} canEdit={canEdit} onChange={change} />
                  ))}
                </ol>
              )}
              {done.length > 0 && (
                <details open={!open.length}>
                  <summary className="label-mono cursor-pointer py-2 text-gray-500">
                    Executadas ({done.length})
                  </summary>
                  <ol className="space-y-3" data-testid="ideas-done">
                    {done.map((i, n) => (
                      <IdeaCard key={i.id} i={i} n={n} canEdit={canEdit} onChange={change} />
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
        </div>
        <Card title="Piloto automático">
          <div className="space-y-2 text-sm text-gray-700">
            <p className="flex items-start gap-2">
              <Plane size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <span>
                Em Configurações do teste → Alocação, escolha <strong>Piloto automático</strong>.
              </span>
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
              <li>De hora em hora, mais tráfego para quem tem mais chance de vencer (bandit).</li>
              <li>Variação com veredito de perdedora sai do ar e não volta.</li>
              <li>Com vencedora declarada, todo o tráfego novo vai para ela.</li>
              <li>Cada mudança é publicada sozinha; quem já viu uma variação continua nela.</li>
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
