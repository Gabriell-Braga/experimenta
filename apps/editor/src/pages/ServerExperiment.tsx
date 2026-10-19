import type { Experiment, Goal } from '@abtest/shared';
import { ArrowLeft, BarChart3, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, getExperiment, publish, saveExperiment, type ExperimentRecord } from '../api';
import { navigate } from '../nav';
import { uid } from '../store';
import { Button, Card, inputCls, PageHeader, selectCls, Spinner, StatusBadge, useToast } from '../ui';

/**
 * Campanha server-side: nada é aplicado na página — o SDK decide a variação no backend/app e entrega as
 * variáveis de cada uma. Aqui: tráfego, pesos, variáveis (JSON) e metas por evento.
 */
export function ServerExperimentPage({ id }: { id: string }) {
  const toast = useToast();
  const [rec, setRec] = useState<ExperimentRecord | null>(null);
  const [exp, setExp] = useState<Experiment | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState('');
  useEffect(() => {
    getExperiment(id).then(
      (r) => {
        setRec(r);
        setExp(r.experiment);
        setVars(
          Object.fromEntries(
            r.experiment.variations.map((v) => [v.id, JSON.stringify(v.variables ?? {}, null, 2)]),
          ),
        );
        document.title = `${r.experiment.name} — Experimenta`;
      },
      (e: Error) => toast('error', e.message),
    );
  }, [id, toast]);
  if (!exp || !rec)
    return (
      <div className="grid place-items-center py-24 text-gray-400">
        <Spinner />
      </div>
    );
  const patch = (p: Partial<Experiment>) => setExp({ ...exp, ...p });
  const save = async (andPublish = false) => {
    let variations;
    try {
      variations = exp.variations.map((v) => ({
        ...v,
        variables: JSON.parse(vars[v.id] || '{}') as Record<string, unknown>,
      }));
    } catch {
      return toast('error', 'Variáveis com JSON inválido.');
    }
    setBusy(true);
    try {
      await saveExperiment({
        experiment: { ...exp, variations },
        projectId: rec.projectId,
        editorUrl: rec.editorUrl,
      });
      if (andPublish) await publish();
      toast(
        'success',
        andPublish ? 'Salvo e publicado: o SDK recebe a nova configuração em até 1 min.' : 'Salvo.',
      );
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sdk = `import { createClient } from '@abtest/sdk';

const abt = await createClient({ accountId: '<conta>', cdnUrl: '${API_URL}/cdn' });
const v = abt.getVariation('${exp.key}', usuario.id);
// v.key → '${exp.variations[1]?.key ?? exp.variations[0]!.key}', v.variables → { ... }
abt.track('${exp.goals.find((g): g is Extract<Goal, { type: 'custom' }> => g.type === 'custom')?.event ?? 'compra'}', usuario.id, { value: 99.9 });`;
  return (
    <>
      <button
        onClick={() => navigate('tests', { type: 'server' })}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Server-side
      </button>
      <PageHeader
        eyebrow={`Server-side · ${exp.key}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {exp.name} <StatusBadge status={exp.status} />
          </span>
        }
        actions={
          <>
            <Button onClick={() => navigate('report', { id: exp.id })}>
              <BarChart3 size={14} aria-hidden="true" /> Relatório
            </Button>
            <Button onClick={() => save()} loading={busy} data-testid="server-save">
              Salvar
            </Button>
            <Button variant="accent" onClick={() => save(true)} loading={busy} data-testid="server-publish">
              Salvar e publicar
            </Button>
          </>
        }
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Variações e variáveis">
            <ul className="space-y-4">
              {exp.variations.map((v, i) => (
                <li
                  key={v.id}
                  className="rounded-md border border-gray-900/10 p-3"
                  data-testid="server-variation"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`grid h-5 min-w-5 place-items-center rounded-sm px-1 font-mono text-[10px] font-semibold ${i === 0 ? 'bg-gray-100 text-gray-600' : 'bg-ink text-lime'}`}
                    >
                      {i === 0 ? 'C' : `V${i}`}
                    </span>
                    <input
                      value={v.name}
                      onChange={(e) =>
                        patch({
                          variations: exp.variations.map((x) =>
                            x.id === v.id ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                      className={`${inputCls} w-48 py-1`}
                      aria-label="Nome da variação"
                    />
                    <code className="font-mono text-xs text-gray-500">{v.key}</code>
                    <span className="flex-1" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      peso
                      <input
                        type="number"
                        min={0}
                        value={v.weight}
                        onChange={(e) =>
                          patch({
                            variations: exp.variations.map((x) =>
                              x.id === v.id
                                ? { ...x, weight: Math.max(0, Math.round(Number(e.target.value))) }
                                : x,
                            ),
                          })
                        }
                        className={`${inputCls} w-16 py-1`}
                      />
                    </label>
                    {i > 0 && exp.variations.length > 2 && (
                      <button
                        onClick={() => patch({ variations: exp.variations.filter((x) => x.id !== v.id) })}
                        className="text-gray-400 hover:text-signal"
                        aria-label="Remover variação"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={vars[v.id] ?? '{}'}
                    onChange={(e) => setVars({ ...vars, [v.id]: e.target.value })}
                    rows={4}
                    spellCheck={false}
                    className={`${inputCls} mt-2 font-mono text-xs`}
                    aria-label={`Variáveis de ${v.name}`}
                    data-testid="server-variables"
                  />
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                const n = exp.variations.length;
                const v = {
                  id: uid('var'),
                  key: `variacao-${n}`,
                  name: `Variação ${n}`,
                  weight: 50,
                  operations: [],
                  customCSS: '',
                  customJS: '',
                  variables: {},
                };
                patch({ variations: [...exp.variations, v] });
                setVars({ ...vars, [v.id]: '{}' });
              }}
            >
              <Plus size={14} aria-hidden="true" /> Variação
            </Button>
          </Card>
          <Card title="Como usar no seu backend">
            <pre className="overflow-x-auto rounded-md bg-ink p-4 font-mono text-[12px] leading-relaxed text-[#e8e4da]">
              {sdk}
            </pre>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Entrega">
            <label className="mb-3 block text-sm">
              <span className="label-mono mb-1 block">Status</span>
              <select
                value={exp.status}
                onChange={(e) => patch({ status: e.target.value as Experiment['status'] })}
                className={`${selectCls} w-full`}
                data-testid="server-status"
              >
                <option value="draft">Rascunho</option>
                <option value="running">Em execução</option>
                <option value="paused">Pausado</option>
                <option value="archived">Arquivado</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Tráfego no experimento: {exp.traffic}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={exp.traffic}
                onChange={(e) => patch({ traffic: Number(e.target.value) })}
                className="w-full accent-[#12825f]"
              />
            </label>
          </Card>
          <Card title="Metas (eventos do SDK)">
            <ul className="space-y-1.5">
              {exp.goals.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm"
                >
                  <code className="font-mono text-xs">{g.type === 'custom' ? g.event : g.key}</code>
                  <button
                    onClick={() => patch({ goals: exp.goals.filter((x) => x.id !== g.id) })}
                    aria-label="Remover meta"
                    className="text-gray-400 hover:text-signal"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = event.trim();
                if (!name) return;
                const key =
                  name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '') || 'meta';
                patch({ goals: [...exp.goals, { id: uid('goal'), key, type: 'custom', event: name }] });
                setEvent('');
              }}
            >
              <input
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                placeholder="nome do evento"
                className={`${inputCls} py-1 font-mono text-xs`}
              />
              <Button size="sm" type="submit">
                Adicionar
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
