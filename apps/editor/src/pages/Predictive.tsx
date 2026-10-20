import type { PropensityConfig } from '@abtest/shared';
import { BrainCircuit } from 'lucide-react';
import { useEffect, useState } from 'react';
import { entities, getOverview, getPredictive, trainPredictive, type Me } from '../api';
import { BarList } from '../charts';
import { navigate } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  LoadingBlock,
  PageHeader,
  selectCls,
  Stat,
  timeAgo,
  useLoad,
  useToast,
} from '../ui';

/** Leitura da AUC em palavras (0,5 = acaso). */
const aucLabel = (a: number) => (a >= 0.8 ? 'ótimo' : a >= 0.7 ? 'bom' : a >= 0.6 ? 'razoável' : 'fraco');

export function PredictivePage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const { data, reload } = useLoad(getPredictive, []);
  const [events, setEvents] = useState<string[]>([]);
  const [cfg, setCfg] = useState<PropensityConfig>({ goal: '', horizonDays: 7, enabled: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.config) setCfg(data.config.data);
  }, [data]);
  useEffect(() => {
    document.title = 'Analytics preditivo · Experimenta';
    getOverview(90).then(
      (o) => setEvents(o.topEvents.map((e) => e.key)),
      () => {},
    );
  }, []);
  const train = async () => {
    setBusy(true);
    try {
      await entities.save('propensity', { id: data?.config?.id, name: cfg.goal, data: cfg });
      await trainPredictive();
      toast('success', 'Modelo treinado e publicado: o snippet já calcula o score.');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
      reload();
    } finally {
      setBusy(false);
    }
  };
  const m = data?.model;
  const maxImp = Math.max(0.01, ...(m?.importance ?? []).map((x) => Math.abs(x.weight)));
  const top = m?.deciles[0];
  const suggested = m?.deciles[1]?.minScore;
  return (
    <>
      <PageHeader
        eyebrow="Insights · IA"
        title="Analytics preditivo"
        description="Um modelo aprende com o histórico quem tende a fazer a meta. O score (0 a 1) é calculado no navegador a cada página e vira regra de audiência: ofereça ajuda a quem está quase comprando, desconto a quem não vai."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card title="O que prever">
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="label-mono mb-1 block">Meta (evento)</span>
              <input
                list="pred-events"
                value={cfg.goal}
                onChange={(e) => setCfg({ ...cfg, goal: e.target.value })}
                placeholder="compra"
                className={`${inputCls} font-mono`}
                disabled={!canEdit}
                data-testid="pred-goal"
              />
              <datalist id="pred-events">
                {events.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="label-mono mb-1 block">Janela</span>
              <select
                value={cfg.horizonDays}
                onChange={(e) => setCfg({ ...cfg, horizonDays: Number(e.target.value) })}
                className={selectCls}
                disabled={!canEdit}
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    fazer a meta em até {d} {d === 1 ? 'dia' : 'dias'}
                  </option>
                ))}
              </select>
            </label>
            {canEdit && (
              <Button
                variant="primary"
                loading={busy}
                disabled={!cfg.goal}
                onClick={() => train()}
                data-testid="pred-train"
              >
                {m ? 'Salvar e retreinar' : 'Treinar modelo'}
              </Button>
            )}
            <p className="text-xs text-gray-500">
              Usa os últimos 90 dias e retreina de hora em hora. Features: páginas, sessões, recência,
              eventos, metas anteriores, dispositivo, origem e identificação. Nada sai do navegador para
              calcular o score.
            </p>
          </div>
        </Card>
        <div className="space-y-5">
          {data === null ? (
            <LoadingBlock stats={4} rows={6} />
          ) : !m ? (
            <EmptyState icon={<BrainCircuit size={20} aria-hidden="true" />} title="Nenhum modelo treinado">
              Escolha a meta e treine. É preciso ao menos 20 visitantes que fizeram a meta no período.
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pred-model">
                <Stat
                  label="Qualidade (AUC)"
                  value={m.auc.toFixed(2).replace('.', ',')}
                  hint={aucLabel(m.auc)}
                />
                <Stat label="Taxa base" value={fmt.pct(m.baseRate)} hint={`meta em ${m.horizonDays} d`} />
                <Stat
                  label="Top 10% converte"
                  value={top ? fmt.pct(top.rate) : 'n/d'}
                  tone="up"
                  hint={
                    top && m.baseRate
                      ? `${(top.rate / m.baseRate).toFixed(1).replace('.', ',')}× a base`
                      : undefined
                  }
                />
                <Stat
                  label="Treinado"
                  value={timeAgo(m.trainedAt)}
                  hint={`${fmt.int(m.samples)} exemplos · ${fmt.int(m.positives)} visitantes na meta`}
                />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Card title="Conversão real por faixa de score">
                  <BarList
                    format={(n) => fmt.pct(n)}
                    items={m.deciles.map((d, i) => ({
                      key: String(i),
                      label: i === 0 ? 'Top 10%' : `${i * 10} a ${(i + 1) * 10}%`,
                      value: d.rate,
                      hint: `score ≥ ${d.minScore.toFixed(2).replace('.', ',')}`,
                    }))}
                  />
                  <p className="mt-3 text-xs text-gray-500">
                    Visitantes do teste (20% separados do treino), do maior score para o menor.
                  </p>
                </Card>
                <Card title="O que pesa no score">
                  <ul className="space-y-2" data-testid="pred-importance">
                    {m.importance.map((x) => (
                      <li
                        key={x.feature}
                        className="grid grid-cols-[1fr_120px_48px] items-center gap-2 text-[13px]"
                      >
                        <span className="truncate text-gray-700">{x.feature}</span>
                        <span className="relative h-1.5 rounded-sm bg-gray-100">
                          <span
                            className={`absolute top-0 h-full rounded-sm ${x.weight >= 0 ? 'left-1/2 bg-brand-500' : 'right-1/2 bg-signal'}`}
                            style={{ width: `${(Math.abs(x.weight) / maxImp) * 50}%` }}
                          />
                        </span>
                        <span className="tabular text-right font-mono text-xs text-gray-600">
                          {x.weight >= 0 ? '+' : '−'}
                          {Math.abs(x.weight).toFixed(2).replace('.', ',')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-gray-500">
                    Peso por desvio-padrão da feature: à direita aumenta a chance, à esquerda diminui.
                  </p>
                </Card>
              </div>
              {suggested !== undefined && (
                <Card title="Usar o score">
                  <p className="text-sm text-gray-700">
                    Os 20% mais propensos têm score ≥{' '}
                    <strong className="font-mono">{suggested.toFixed(2).replace('.', ',')}</strong>. Crie uma
                    audiência com a regra <em>Score preditivo ≥ {suggested.toFixed(2).replace('.', ',')}</em>{' '}
                    e use em testes, personalizações, pop-ups e pesquisas.
                  </p>
                  <Button className="mt-3" size="sm" onClick={() => navigate('audiences')}>
                    Ir para audiências
                  </Button>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
