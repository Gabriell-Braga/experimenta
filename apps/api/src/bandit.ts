import { banditWeights } from '@abtest/shared';
import { experimentReport } from './analytics/report';
import type { AppDeps } from './app';
import type { Repo, User } from './repo';

const DAY = 86_400_000;
/** Janela de dados usada no rebalanceamento. */
export const BANDIT_WINDOW_DAYS = 30;

/**
 * Recalcula os pesos de um experimento com alocação `bandit` pela meta primária (Thompson sampling) e salva
 * uma nova versão se mudaram. Só afeta visitantes NOVOS: a atribuição de quem já entrou é persistida.
 */
export async function rebalance(repo: Repo, accountId: string, experimentId: string, now = Date.now()) {
  const rec = await repo.getExperiment(accountId, experimentId);
  if (!rec || rec.experiment.allocation !== 'bandit' || rec.experiment.status !== 'running') return null;
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
  const weights = banditWeights(arms);
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
  createdAt: new Date(0),
});

/** Job periódico: rebalanceia todos os bandits em execução e republica as contas que mudaram. */
export async function rebalanceAll(repo: Repo, publish: AppDeps['publish']) {
  const touched = new Set<string>();
  for (const { accountId, id } of await repo.listBanditExperiments()) {
    const r = await rebalance(repo, accountId, id).catch(() => null);
    if (r?.changed) touched.add(accountId);
  }
  for (const accountId of touched) await publish?.(accountId, banditUser(accountId)).catch(() => undefined);
  return [...touched];
}
