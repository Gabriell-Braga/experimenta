import { Copy, Plane, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getIdeas, type Ideas, type Me } from '../api';
import { navigate } from '../nav';
import { Button, Card, EmptyState, PageHeader, Segmented, useToast } from '../ui';
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

export function OptimizePage({ user }: { user: Me }) {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [data, setData] = useState<Ideas | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Otimização por IA — Experimenta';
  }, []);
  const run = async () => {
    setBusy(true);
    try {
      setData(await getIdeas(Number(days)));
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canEdit = user.role !== 'viewer';
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
          <div className="flex items-center gap-3">
            {canEdit && (
              <Button variant="primary" loading={busy} onClick={() => void run()} data-testid="ideas-run">
                <Sparkles size={16} aria-hidden="true" /> {data ? 'Gerar de novo' : 'Gerar ideias'}
              </Button>
            )}
            {data && (
              <span className="label-mono" data-testid="ideas-source">
                {data.source === 'claude'
                  ? `por Claude (${data.model})`
                  : 'por regras · sem chave da API do Claude'}
              </span>
            )}
          </div>
          {!data ? (
            <EmptyState icon={<Sparkles size={20} aria-hidden="true" />} title="Pronto para sugerir">
              As ideias usam só números agregados do período (nenhum dado de visitante sai da conta).
            </EmptyState>
          ) : !data.ideas.length ? (
            <EmptyState icon={<Sparkles size={20} aria-hidden="true" />} title="Sem ideias neste período">
              Ainda não há achados suficientes. Colete mais dados ou aumente o período.
            </EmptyState>
          ) : (
            <ol className="space-y-3" data-testid="ideas">
              {data.ideas.map((i, n) => (
                <li key={n} className="rounded-lg border border-gray-900/10 bg-white p-4" data-testid="idea">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs text-gray-400">{String(n + 1).padStart(2, '0')}</span>
                    <h3 className="font-display text-lg leading-tight text-ink">{i.title}</h3>
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
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => navigate('tests')}>
                      Criar teste
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(
                            `${i.title}\nHipótese: ${i.hypothesis}\nMudança: ${i.change}\nMeta: ${i.metric}`,
                          )
                          .then(() => toast('success', 'Ideia copiada.'))
                      }
                    >
                      <Copy size={14} aria-hidden="true" /> Copiar
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
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
