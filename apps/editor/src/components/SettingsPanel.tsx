import { MousePointerClick, X } from 'lucide-react';
import type { Audience, Experiment, Goal, UrlRule } from '@abtest/shared';
import { useState, type Dispatch, type ReactNode } from 'react';
import { entities, type Entity } from '../api';
import { describeRule } from '../pages/Audiences';
import { canFunnel, uid, type Action } from '../store';
import { Skeleton, useLoad } from '../ui';

/** Audiências salvas que o visitante precisa atender (todas), além das páginas e dispositivos. */
function AudiencePicker({ experiment, onChange }: { experiment: Experiment; onChange(ids: string[]): void }) {
  const { data: list } = useLoad(
    () => entities.list<Audience>('audience').catch((): Entity<Audience>[] => []),
    [],
  );
  const chosen = experiment.audiences;
  return (
    <fieldset className="flex flex-col gap-1" data-testid="audiences-picker">
      <legend className="mb-1 text-gray-600">Audiências (todas precisam bater)</legend>
      {list === null ? (
        <div className="space-y-1.5" role="status" aria-label="Carregando">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
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

const ALLOCATIONS: [Experiment['allocation'], string, string][] = [
  ['manual', 'Pesos fixos', 'A divisão que você definir abaixo. O melhor para aprender com o teste.'],
  [
    'bandit',
    'Bandit (multi-armed)',
    'A cada hora, mais tráfego para a variação com mais chance de vencer na meta primária (Thompson sampling, mínimo de 5% para cada). Bom para promoções curtas.',
  ],
  [
    'autopilot',
    'Piloto automático',
    'Bandit + corta as variações perdedoras e, quando houver vencedora, manda todo o tráfego para ela. Republica sozinho.',
  ],
];

/** Passos da configuração (21.5): Hipótese (URL) → Variação → Objetivos → Preview e QA. */
export const SETTINGS_STEPS = [
  ['hypothesis', 'Hipótese (URL)'],
  ['variation', 'Variação'],
  ['goals', 'Objetivos'],
  ['qa', 'Preview e QA'],
] as const;
export type SettingsStep = (typeof SETTINGS_STEPS)[number][0];

const changed = (v: Experiment['variations'][number]) =>
  v.operations.length > 0 || !!v.customCSS.trim() || !!v.customJS.trim() || !!v.redirect;

/** O que falta para o passo estar completo ('' = completo). "Próximo" só avança com o passo completo. */
export function stepMissing(e: Experiment, step: SettingsStep): string {
  if (step === 'hypothesis') return e.hypothesis?.trim() ? '' : 'Escreva a hipótese do teste.';
  if (step === 'variation')
    return e.type === 'rollout' ||
      e.variations.slice(1).some(changed) ||
      e.variations.some((v) => v.variables)
      ? ''
      : 'Faça ao menos uma alteração numa variação (no site, à esquerda).';
  if (step === 'goals') return e.goals.length ? '' : 'Adicione ao menos uma meta.';
  return '';
}

/** Alterações por variação: o que o passo "Variação" confere antes de seguir. */
function VariationSummary({ experiment }: { experiment: Experiment }) {
  return (
    <div className="flex flex-col gap-1" data-testid="variation-summary">
      <span className="mb-1 text-gray-600">Alterações por variação</span>
      {experiment.variations.map((v, i) => (
        <span key={v.id} className="flex justify-between gap-2 text-xs">
          <span>{v.name}</span>
          <span className="font-mono text-gray-500">
            {i === 0 && !changed(v)
              ? 'original'
              : v.redirect
                ? 'redireciona'
                : `${v.operations.length} alteraç${v.operations.length === 1 ? 'ão' : 'ões'}${v.customCSS.trim() ? ' + CSS' : ''}${v.customJS.trim() ? ' + JS' : ''}`}
          </span>
        </span>
      ))}
      <p className="mt-1 text-xs text-gray-500">
        Edite as variações direto no site: feche esta janela, escolha a variação na barra e clique nos
        elementos.
      </p>
    </div>
  );
}

/** Status do experimento (fica no rodapé da janela: vale para todos os passos). */
export function StatusSelect({
  experiment,
  onChange,
}: {
  experiment: Experiment;
  onChange(p: { status: Experiment['status'] }): void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">Status</span>
      <select
        value={experiment.status}
        onChange={(e) => onChange({ status: e.target.value as Experiment['status'] })}
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
  );
}

/** Teste multipágina: páginas do funil (nome e regra de URL); entrar no funil começa pela página aberta. */
function FunnelSettings({
  experiment,
  url,
  dispatch,
}: {
  experiment: Experiment;
  url: string;
  dispatch: Dispatch<Action>;
}) {
  const pages = experiment.pages ?? [];
  const patchPage = (id: string, patch: Extract<Action, { type: 'patchPage' }>['patch']) =>
    dispatch({ type: 'patchPage', id, patch });
  return (
    <fieldset className="flex flex-col gap-1" data-testid="funnel-settings">
      <legend className="mb-1 text-gray-600">Teste multipágina (funil)</legend>
      {!pages.length ? (
        <>
          <p className="text-xs text-gray-500">
            Alterações em várias páginas do mesmo fluxo (ex.: carrinho → pagamento), com o visitante na mesma
            variação em todas.
          </p>
          <button
            onClick={() => dispatch({ type: 'addPage', url })}
            className="self-start text-xs text-orange-600"
            data-testid="make-funnel"
          >
            + transformar em multipágina (começando por esta página)
          </button>
        </>
      ) : (
        <>
          {pages.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1" data-testid="funnel-page-settings">
              <span className="w-4 shrink-0 text-xs text-gray-400">{i + 1}</span>
              <input
                key={p.name}
                defaultValue={p.name}
                aria-label="Nome da página"
                className={`${input} w-28`}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== p.name) patchPage(p.id, { name });
                }}
              />
              <select
                value={p.match.match}
                aria-label="Tipo de regra"
                onChange={(e) =>
                  patchPage(p.id, { match: { ...p.match, match: e.target.value as UrlRule['match'] } })
                }
                className={`${input} px-1`}
              >
                <option value="exact">é</option>
                <option value="contains">contém</option>
                <option value="regex">regex</option>
              </select>
              <input
                key={p.match.value}
                defaultValue={p.match.value}
                aria-label="URL da página"
                className={`${input} min-w-0 flex-1`}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value && value !== p.match.value) patchPage(p.id, { match: { ...p.match, value } });
                }}
              />
              <button
                onClick={() => dispatch({ type: 'removePage', id: p.id })}
                aria-label={
                  pages.length > 1 ? 'Remover página e as alterações dela' : 'Voltar a página única'
                }
                title={pages.length > 1 ? 'Remover página e as alterações dela' : 'Voltar a página única'}
                className="px-1 text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <p className="text-xs text-gray-500">
            O visitante fica na mesma variação em todas as páginas e é contado na primeira que vê. Cada página
            tem as próprias alterações; CSS/JS da variação valem em todas. Para incluir outra página, navegue
            até ela no site e use “Adicionar esta página ao funil”.
          </p>
        </>
      )}
    </fieldset>
  );
}

export function SettingsPanel({
  experiment,
  url,
  dispatch,
  goal,
  onGoal,
  onPick,
  step,
  qa,
}: {
  experiment: Experiment;
  /** Passo da configuração (21.5): cada um mostra só o seu bloco. */
  step: SettingsStep;
  /** Conteúdo do passo "Preview e QA" (fica no EditorView, que tem a conexão com o site). */
  qa?: ReactNode;
  /** Página aberta no editor (1ª página ao transformar em multipágina). */
  url: string;
  dispatch: Dispatch<Action>;
  goal: GoalDraft;
  onGoal(g: GoalDraft): void;
  /** Fecha a janela e espera o clique no elemento da meta no site. */
  onPick(): void;
}) {
  const patch = (p: Extract<Action, { type: 'patchExperiment' }>['patch']) =>
    dispatch({ type: 'patchExperiment', patch: p });
  // Estatística do relatório (17.5): opções independentes; metas de guarda por id.
  const patchStats = (p: NonNullable<Experiment['stats']>) => patch({ stats: { ...experiment.stats, ...p } });
  const guards = experiment.stats?.guardrails ?? [];
  const totalWeight = experiment.variations.reduce((t, v) => t + v.weight, 0) || 1;
  const setGoal = onGoal;
  const [goalError, setGoalError] = useState('');
  const [focusLast, setFocusLast] = useState(false);
  const urls = experiment.segmentation.urls;
  const setUrls = (next: UrlRule[]) => patch({ segmentation: { ...experiment.segmentation, urls: next } });

  return (
    <div className="grid gap-x-8 gap-y-5 text-sm md:grid-cols-2" data-testid="settings" data-step={step}>
      {step === 'hypothesis' && (
        <>
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

            <label className="flex flex-col gap-1">
              <span className="text-gray-600">Hipótese</span>
              <textarea
                key={experiment.hypothesis ?? ''}
                defaultValue={experiment.hypothesis ?? ''}
                maxLength={2000}
                rows={3}
                placeholder="Se mudarmos X, então Y, porque Z"
                className={input}
                data-testid="hypothesis"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (experiment.hypothesis ?? '')) patch({ hypothesis: v || undefined });
                }}
              />
            </label>
          </div>
          <div className="flex flex-col gap-4">
            <AudiencePicker experiment={experiment} onChange={(audiences) => patch({ audiences })} />
            {canFunnel(experiment) && (
              <FunnelSettings experiment={experiment} url={url} dispatch={dispatch} />
            )}
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-gray-600">
                {experiment.pages?.length ? 'Exclusões de URL' : 'Páginas (segmentação por URL)'}
              </legend>
              {!!experiment.pages?.length && (
                <p className="text-xs text-gray-500">
                  As páginas do funil definem onde o teste roda; aqui valem só as regras marcadas “não”.
                </p>
              )}
              {urls.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <select
                    value={r.match}
                    onChange={(e) =>
                      setUrls(
                        urls.map((u, j) =>
                          j === i ? { ...u, match: e.target.value as UrlRule['match'] } : u,
                        ),
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
                  setUrls([...urls, { match: 'contains', value: '', exclude: !!experiment.pages?.length }]);
                }}
                className="self-start text-xs text-orange-600"
                data-testid="add-url-rule"
              >
                + regra de URL
              </button>
              {!urls.length && !experiment.pages?.length && (
                <p className="text-xs text-gray-500">Sem regras: roda em todas as páginas.</p>
              )}
            </fieldset>
          </div>
        </>
      )}
      {step === 'variation' && (
        <>
          <div className="flex flex-col gap-4">
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
              <fieldset className="flex flex-col gap-1.5 rounded-md border border-gray-900/10 p-2">
                <legend className="px-1 text-gray-600">Alocação do tráfego</legend>
                {ALLOCATIONS.map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="allocation"
                      className="mt-0.5"
                      checked={experiment.allocation === value}
                      onChange={() => patch({ allocation: value })}
                      data-testid={`allocation-${value}`}
                    />
                    <span>
                      <span className="font-medium text-ink">{label}</span>
                      <span className="block text-xs text-gray-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-1" disabled={experiment.allocation !== 'manual'}>
              <legend className="mb-1 text-gray-600">
                Divisão entre variações (pesos)
                {experiment.allocation !== 'manual' && ' (controlada automaticamente)'}
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
                            redirect: url
                              ? { url, preserveQuery: v.redirect?.preserveQuery ?? true }
                              : undefined,
                          },
                        });
                      }}
                    />
                  )}
                </div>
              ))}
            </fieldset>
          </div>
          <VariationSummary experiment={experiment} />
        </>
      )}
      {step === 'goals' && (
        <div className="flex flex-col gap-4 md:col-span-2">
          {' '}
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
                {i > 0 && experiment.variations.length > 1 && (
                  <label
                    className="flex shrink-0 items-center gap-1 text-xs text-gray-600"
                    title="Meta de guarda: alerta se uma variação piorar esta meta e impede que ela seja declarada vencedora"
                  >
                    <input
                      type="checkbox"
                      checked={guards.includes(g.id)}
                      onChange={(e) =>
                        patchStats({
                          guardrails: e.target.checked
                            ? [...guards, g.id]
                            : guards.filter((id) => id !== g.id),
                        })
                      }
                      data-testid="goal-guardrail"
                    />
                    guarda
                  </label>
                )}
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
              <button
                type="submit"
                className="self-start rounded bg-gray-100 px-2 py-1 text-xs"
                data-testid="goal-add"
              >
                Adicionar meta
              </button>
            </form>
          </fieldset>
          {experiment.variations.length > 1 && experiment.type !== 'rollout' && (
            <fieldset
              className="flex flex-col gap-1.5 rounded-md border border-gray-900/10 p-2"
              data-testid="stats-settings"
            >
              <legend className="px-1 text-gray-600">Estatística do relatório</legend>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!experiment.stats?.sequential}
                  onChange={(e) => patchStats({ sequential: e.target.checked || undefined })}
                  data-testid="stats-sequential"
                />
                <span>
                  <span className="font-medium text-ink">Teste sequencial</span>
                  <span className="block text-xs text-gray-500">
                    Pode olhar o resultado a qualquer momento sem aumentar o falso positivo (mSPRT). Exige um
                    pouco mais de visitantes para declarar vencedora.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!experiment.stats?.cuped}
                  onChange={(e) => patchStats({ cuped: e.target.checked || undefined })}
                  data-testid="stats-cuped"
                />
                <span>
                  <span className="font-medium text-ink">Redução de variância (CUPED)</span>
                  <span className="block text-xs text-gray-500">
                    Desconta o quanto cada visitante já navegava antes do teste (páginas vistas nos 30 dias
                    anteriores). Resultados mais firmes com menos tráfego; o relatório mostra a redução
                    obtida.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
        </div>
      )}
      {step === 'qa' && qa}
    </div>
  );
}
