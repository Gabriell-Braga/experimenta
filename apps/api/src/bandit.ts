import { banditWeights } from '@abtest/shared';
import { retrainPropensity } from './predict';
import { experimentReport } from './analytics/report';
import type { AppDeps } from './app';
import type { CdnStore } from './cdn';
import { rebuildReco } from './reco';
import type { Repo, User } from './repo';

const DAY = 86_400_000;
/** Janela de dados usada no rebalanceamento. */
export const BANDIT_WINDOW_DAYS = 30;

/**
 * Piloto automático sobre os pesos do bandit: perdedora (veredito na meta primária) sai do ar e não volta;
 * com vencedora declarada, só as vencedoras recebem tráfego. Sempre sobra ao menos uma variação.
 */
export function autopilotWeights(
  weights: number[],
  arms: { verdict: string }[],
  exp: { variations: { weight: number }[] },
): number[] {
  const winners = arms.some((a) => a.verdict === 'winner');
  const out = weights.map((w, i) => {
    const v = arms[i]?.verdict;
    if (winners) return v === 'winner' ? w : 0;
    return v === 'loser' || exp.variations[i]?.weight === 0 ? 0 : w;
  });
  return out.some((w) => w > 0) ? out : weights;
}

/**
 * Recalcula os pesos de um experimento com alocação `bandit` pela meta primária (Thompson sampling) e salva
 * uma nova versão se mudaram. Só afeta visitantes NOVOS: a atribuição de quem já entrou é persistida.
 */
export async function rebalance(repo: Repo, accountId: string, experimentId: string, now = Date.now()) {
  const rec = await repo.getExperiment(accountId, experimentId);
  if (!rec || rec.experiment.allocation === 'manual' || rec.experiment.status !== 'running') return null;
  const exp = rec.experiment;
  const range = { from: new Date(now - BANDIT_WINDOW_DAYS * DAY), to: new Date(now) };
  const events = await repo.listEvents(accountId, {
    experimentId,
    types: ['exposure', 'conversion'],
    ...range,
  });
  const report = experimentReport(exp, events, range);
  const arms =
    report.goals[0]?.arms.map((a) => ({ visitors: a.visitors, conversions: a.conversions })) ??
    report.variations.map((v) => ({ visitors: v.visitors, conversions: 0 }));
  const weights =
    exp.allocation === 'autopilot'
      ? autopilotWeights(banditWeights(arms), report.goals[0]?.arms ?? [], exp)
      : banditWeights(arms);
  const changed = exp.variations.some((v, i) => v.weight !== weights[i]);
  if (changed)
    await repo.saveExperiment(accountId, {
      projectId: rec.projectId,
      editorUrl: rec.editorUrl,
      experiment: { ...exp, variations: exp.variations.map((v, i) => ({ ...v, weight: weights[i]! })) },
    });
  return { changed, weights };
}

/**
 * Usuário de sistema para publicar o rebalanceamento: papel editor SEM permissão de JS — se houver customJS
 * novo ainda não publicado por quem pode, a publicação automática é recusada (os pesos ficam salvos).
 */
export const banditUser = (accountId: string): User => ({
  id: 'system:bandit',
  accountId,
  email: 'bandit@sistema',
  name: 'Alocação automática',
  role: 'editor',
  canPublishJs: false,
  passwordHash: '',
  mfa: null,
  createdAt: new Date(0),
});

/** Job periódico: rebalanceia todos os bandits em execução e republica as contas que mudaram. */
// (os modelos de recomendação são recalculados no mesmo ciclo: ver `hourlyJobs`)
export async function rebalanceAll(repo: Repo, publish: AppDeps['publish']) {
  const touched = new Set<string>();
  for (const { accountId, id } of await repo.listBanditExperiments()) {
    const r = await rebalance(repo, accountId, id).catch(() => null);
    if (r?.changed) touched.add(accountId);
  }
  for (const accountId of touched) await publish?.(accountId, banditUser(accountId)).catch(() => undefined);
  return [...touched];
}

/** Ciclo de hora em hora: bandits e modelos de recomendação das contas com vitrine. */
export async function hourlyJobs(repo: Repo, cdn: CdnStore, publish: AppDeps['publish']) {
  await rebalanceAll(repo, publish);
  for (const accountId of await repo.listAccountsWithEntity('reco'))
    await rebuildReco(repo, cdn, accountId).catch(() => undefined);
  // Propensão: retreina e republica (o modelo vai na config do site).
  for (const accountId of await repo.listAccountsWithEntity('propensity')) {
    const r = await retrainPropensity(repo, accountId).catch(() => null);
    if (r && !('error' in r)) await publish?.(accountId, banditUser(accountId)).catch(() => undefined);
  }
}
