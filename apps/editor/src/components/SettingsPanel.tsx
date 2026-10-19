import { MousePointerClick, X } from 'lucide-react';
import type { Audience, Experiment, Goal, UrlRule } from '@abtest/shared';
import { useEffect, useState, type Dispatch } from 'react';
import { entities, type Entity } from '../api';
import { describeRule } from '../pages/Audiences';
import { uid, type Action } from '../store';

/** Audiências salvas que o visitante precisa atender (todas), além das páginas e dispositivos. */
function AudiencePicker({ experiment, onChange }: { experiment: Experiment; onChange(ids: string[]): void }) {
  const [list, setList] = useState<Entity<Audience>[] | null>(null);
  useEffect(() => {
    entities.list<Audience>('audience').then(setList, () => setList([]));
  }, []);
  const chosen = experiment.audiences;
  return (
    <fieldset className="flex flex-col gap-1" data-testid="audiences-picker">
      <legend className="mb-1 text-gray-600">Audiências (todas precisam bater)</legend>
      {list === null ? (
        <span className="text-xs text-gray-400">Carregando…</span>
      ) : !list.length ? (
        <span className="text-xs text-gray-500">Nenhuma audiência salva (Dados → Audiências).</span>
      ) : (
        list.map((a) => (
          <label key={a.id} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={chosen.includes(a.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))
              }
            />
            <span className="min-w-0">
              <span className="block text-sm">{a.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-gray-500">
                {a.data.rules.map(describeRule).join(a.data.match === 'all' ? ' e ' : ' ou ')}
              </span>
            </span>
          </label>
        ))
      )}
      {chosen.some((id) => list && !list.some((a) => a.id === id)) && (
        <span className="text-xs text-signal">
          Uma audiência escolhida foi excluída: ninguém entra até você desmarcá-la.
        </span>
      )}
    </fieldset>
  );
}

/** Meta sendo criada (fica no EditorView: sobrevive ao "Escolher no site", que fecha a janela). */
export interface GoalDraft {
  type: Goal['type'];
  value: string;
  name: string;
}
export const EMPTY_GOAL: GoalDraft = { type: 'click', value: '', name: '' };

const input = 'rounded border border-gray-300 px-2 py-1 text-sm';
const STATUS = {
  draft: 'Rascunho',
  running: 'Em execução',
  paused: 'Pausado',
  archived: 'Arquivado',
} as const;
const GOAL_TYPES = {
  click: 'Clique em elemento',
  pageview: 'Visita a URL',
  formSubmit: 'Envio de formulário',
  custom: 'Evento custom',
};

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'meta';

function goalTarget(g: Goal): string {
  if (g.type === 'pageview') return g.url.value;
  if (g.type === 'custom') return g.event;
  return g.selector;
}

export function SettingsPanel({
  experiment,
  dispatch,
  goal,
  onGoal,
  onPick,
}: {
  experiment: Experiment;
  dispatch: Dispatch<Action>;
  goal: GoalDraft;
  onGoal(g: GoalDraft): void;
  /** Fecha a janela e espera o clique no elemento da meta no site. */
  onPick(): void;
}) {
  const patch = (p: Extract<Action, { type: 'patchExperiment' }>['patch']) =>
    dispatch({ type: 'patchExperiment', patch: p });
  const totalWeight = experiment.variations.reduce((t, v) => t + v.weight, 0) || 1;
  const setGoal = onGoal;
  const [goalError, setGoalError] = useState('');
  const [focusLast, setFocusLast] = useState(false);
  const urls = experiment.segmentation.urls;
  const setUrls = (next: UrlRule[]) => patch({ segmentation: { ...experiment.segmentation, urls: next } });

  return (
    <div className="grid gap-x-8 gap-y-5 text-sm md:grid-cols-2" data-testid="settings">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-gray-600">Nome</span>
          <input
            key={experiment.name}
            defaultValue={experiment.name}
            className={input}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== experiment.name &&
              patch({ name: e.target.value.trim() })
            }
          />
        </label>

        <label className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Status</span>
          <select
            value={experiment.status}
            onChange={(e) => patch({ status: e.target.value as Experiment['status'] })}
            className={input}
            data-testid="status-select"
          >
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Tráfego no experimento (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            key={experiment.traffic}
            defaultValue={experiment.traffic}
            className={`${input} w-20`}
            data-testid="traffic"
            onBlur={(e) => {
              const t = Math.min(100, Math.max(0, Number(e.target.value)));
              if (t !== experiment.traffic) patch({ traffic: t });
            }}
          />
        </label>

        {experiment.variations.length > 1 && experiment.type !== 'rollout' && (
          <label className="flex items-start gap-2 rounded-md border border-gray-900/10 p-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={experiment.allocation === 'bandit'}
              onChange={(e) => patch({ allocation: e.target.checked ? 'bandit' : 'manual' })}
              data-testid="allocation-bandit"
            />
            <span>
              <span className="font-medium text-ink">Alocação automática (multi-armed bandit)</span>
              <span className="block text-xs text-gray-500">
                A cada hora, mais tráfego vai para a variação com mais chance de vencer na meta primária
                (Thompson sampling, mínimo de 5% para cada uma). Bom para promoções curtas; para aprender,
                prefira pesos fixos.
              </span>
            </span>
          </label>
        )}
        <fieldset className="flex flex-col gap-1" disabled={experiment.allocation === 'bandit'}>
          <legend className="mb-1 text-gray-600">
            Divisão entre variações (pesos){experiment.allocation === 'bandit' && ' — controlada pelo bandit'}
          </legend>
          {experiment.variations.map((v, i) => (
            <div key={v.id}>
              <label className="flex items-center justify-between gap-2">
                <span>{v.name}</span>
                <span className="flex items-center gap-2">
                  <span className="w-12 text-right text-xs text-gray-500">
                    {Math.round((v.weight / totalWeight) * 100)}%
                  </span>
                  <input
                    type="number"
                    min={0}
                    key={v.weight}
                    defaultValue={v.weight}
                    className={`${input} w-20`}
                    data-testid={`weight-${v.key}`}
                    onBlur={(e) =>
                      Number(e.target.value) !== v.weight &&
                      dispatch({ type: 'setWeight', id: v.id, weight: Number(e.target.value) })
                    }
                  />
                </span>
              </label>
              {experiment.type === 'split' && i > 0 && (
                <input
                  type="url"
                  key={v.redirect?.url}
                  defaultValue={v.redirect?.url ?? ''}
                  placeholder="https://… (página desta variação)"
                  className={`${input} mt-1 w-full font-mono text-xs`}
                  data-testid={`redirect-${v.key}`}
                  onBlur={(e) => {
                    const url = e.target.value.trim();
                    if (url === (v.redirect?.url ?? '')) return;
                    dispatch({
                      type: 'patchVariation',
                      id: v.id,
                      patch: {
                        redirect: url ? { url, preserveQuery: v.redirect?.preserveQuery ?? true } : undefined,
                      },
                    });
                  }}
                />
              )}
            </div>
          ))}
        </fieldset>
      </div>
      <div className="flex flex-col gap-4">
        <AudiencePicker experiment={experiment} onChange={(audiences) => patch({ audiences })} />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-gray-600">Páginas (segmentação por URL)</legend>
          {urls.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={r.match}
                onChange={(e) =>
                  setUrls(
                    urls.map((u, j) => (j === i ? { ...u, match: e.target.value as UrlRule['match'] } : u)),
                  )
                }
                className={`${input} px-1`}
              >
                <option value="exact">é</option>
                <option value="contains">contém</option>
                <option value="regex">regex</option>
              </select>
              <input
                key={r.value}
                defaultValue={r.value}
                autoFocus={focusLast && !r.value && i === urls.length - 1}
                placeholder="parte da URL, ex.: /produto/"
                className={`${input} min-w-0 flex-1`}
                onBlur={(e) =>
                  e.target.value !== r.value &&
                  setUrls(urls.map((u, j) => (j === i ? { ...u, value: e.target.value } : u)))
                }
              />
              <label className="flex items-center gap-0.5 text-xs" title="Excluir estas páginas">
                <input
                  type="checkbox"
                  checked={r.exclude}
                  onChange={(e) =>
                    setUrls(urls.map((u, j) => (j === i ? { ...u, exclude: e.target.checked } : u)))
                  }
                />
                não
              </label>
              <button
                onClick={() => setUrls(urls.filter((_, j) => j !== i))}
                aria-label="Remover regra"
                className="px-1 text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              setFocusLast(true);
              setUrls([...urls, { match: 'contains', value: '', exclude: false }]);
            }}
            className="self-start text-xs text-orange-600"
            data-testid="add-url-rule"
          >
            + regra de URL
          </button>
          {!urls.length && <p className="text-xs text-gray-500">Sem regras: roda em todas as páginas.</p>}
        </fieldset>

        <fieldset className="flex flex-col gap-1" data-testid="goals">
          <legend className="mb-1 text-gray-600">Metas</legend>
          <p className="text-xs text-gray-500">
            A primeira meta é a <b>primária</b>: decide a vencedora no relatório.
          </p>
          {experiment.goals.map((g, i) => (
            <div
              key={g.id}
              className="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1"
              data-testid="goal"
            >
              <span className="min-w-0">
                <b>{g.key}</b> <span className="text-xs text-gray-500">{GOAL_TYPES[g.type]}</span>
                {i === 0 && (
                  <span className="ml-1.5 font-mono text-[10px] text-brand-600 uppercase">primária</span>
                )}
                <code className="block truncate text-xs">{goalTarget(g)}</code>
              </span>
              {i > 0 && (
                <button
                  onClick={() => patch({ goals: [g, ...experiment.goals.filter((x) => x.id !== g.id)] })}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                  data-testid="goal-primary"
                >
                  Tornar primária
                </button>
              )}
              <button
                onClick={() => patch({ goals: experiment.goals.filter((x) => x.id !== g.id) })}
                aria-label="Remover meta"
                className="px-1 text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <form
            className="flex flex-col gap-1 rounded border border-dashed p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!goal.value.trim()) {
                setGoalError(
                  goal.type === 'pageview'
                    ? 'Informe a URL (ou parte dela).'
                    : goal.type === 'custom'
                      ? 'Informe o nome do evento.'
                      : 'Informe o seletor CSS ou use “Escolher no site”.',
                );
                return;
              }
              setGoalError('');
              const key = slug(goal.name || goal.value);
              const base = { id: uid('goal'), key };
              const g: Goal =
                goal.type === 'pageview'
                  ? {
                      ...base,
                      type: 'pageview',
                      url: { match: 'contains', value: goal.value, exclude: false },
                    }
                  : goal.type === 'custom'
                    ? { ...base, type: 'custom', event: goal.value }
                    : { ...base, type: goal.type, selector: goal.value };
              patch({ goals: [...experiment.goals, g] });
              setGoal({ type: goal.type, value: '', name: '' });
            }}
          >
            <select
              value={goal.type}
              onChange={(e) => setGoal({ ...goal, type: e.target.value as Goal['type'] })}
              className={input}
              data-testid="goal-type"
            >
              {Object.entries(GOAL_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              value={goal.value}
              onChange={(e) => {
                setGoalError('');
                setGoal({ ...goal, value: e.target.value });
              }}
              placeholder={
                goal.type === 'pageview'
                  ? 'URL contém…'
                  : goal.type === 'custom'
                    ? 'nome do evento'
                    : 'seletor CSS'
              }
              className={input}
              data-testid="goal-value"
            />
            {(goal.type === 'click' || goal.type === 'formSubmit') && (
              <button
                type="button"
                onClick={onPick}
                className="flex items-center gap-1 self-start text-xs text-orange-600"
                data-testid="goal-pick"
              >
                <MousePointerClick size={13} aria-hidden="true" />
                Escolher no site{goal.type === 'formSubmit' ? ' (clique no formulário)' : ''}
              </button>
            )}
            {goalError && (
              <p role="alert" className="text-xs text-red-600" data-testid="goal-error">
                {goalError}
              </p>
            )}
            <input
              value={goal.name}
              onChange={(e) => setGoal({ ...goal, name: e.target.value })}
              placeholder="nome da meta (opcional)"
              className={input}
              data-testid="goal-name"
            />
            <button className="self-start rounded bg-gray-100 px-2 py-1 text-xs" data-testid="goal-add">
              Adicionar meta
            </button>
          </form>
        </fieldset>
      </div>
    </div>
  );
}
