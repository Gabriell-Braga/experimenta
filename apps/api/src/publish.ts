import {
  PublishedConfigSchema,
  type Audience,
  type Consent,
  type Experiment,
  type Flag,
  type Group,
  type Integrations,
  type PropensityConfig,
  type SdkConfig,
  type Popup,
  type RecoWidget,
  type Survey,
  type PublishedConfig,
} from '@abtest/shared';
import { MODEL_KIND, type TrainedModel } from './predict';
import { canPublishJs } from './auth';
import { writeAccountFiles, type CdnStore } from './cdn';
import { rebuildReco } from './reco';
import type { Repo, User } from './repo';

export interface PublisherDeps {
  repo: Repo;
  cdn: CdnStore;
  /** URL pública da API (validação de sessões de edição e coleta de eventos). */
  publicUrl: string;
  /** Fração padrão de visitantes com captura de mapa de calor (0 desliga); a conta pode sobrescrever. */
  heatmapSampleRate?: number;
}

/** customJS por variação (id → código) de uma lista de experimentos. */
const jsOf = (exps: Experiment[]) =>
  new Map(
    exps.flatMap((e) =>
      e.variations.filter((v) => v.customJS.trim()).map((v) => [v.id, v.customJS] as const),
    ),
  );

/** Resultado da publicação. `needsApproval`: conta exige aprovação e há mudança que quem publicou não pode aprovar. */
export type PublishResult = { version: number } | { error: string; status: 403 | 400; needsApproval?: true };

export const APPROVAL_ERROR = 'esta conta exige aprovação para publicar (peça a um owner)';

/** JSON com chaves ordenadas: o jsonb do Postgres não guarda a ordem das chaves. */
const canon = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

type SdkPart = Pick<SdkConfig, 'flags' | 'experiments'>;

/**
 * O que muda o site e precisa de aprovação: a config sem versão, data, modelo preditivo (retreina sozinho) e
 * pesos de experimentos com alocação automática (`auto`: bandit/piloto), mais as flags e campanhas do SDK.
 * Assim o rebalanceamento de hora em hora continua publicando, mas não leva junto mudança não aprovada.
 */
function reviewable(c: PublishedConfig, sdk: SdkPart | null, auto: Set<string>) {
  const noWeights = <T extends { id: string; variations: { weight: number }[] }>(e: T) =>
    auto.has(e.id) ? { ...e, variations: e.variations.map((v) => ({ ...v, weight: 0 })) } : e;
  return canon({
    ...c,
    version: 0,
    publishedAt: '',
    propensity: null,
    experiments: c.experiments.map(noWeights),
    sdk: sdk && { flags: sdk.flags, experiments: sdk.experiments.map(noWeights) },
  });
}

async function lastSdk(cdn: CdnStore, accountId: string): Promise<SdkPart | null> {
  try {
    const s = JSON.parse((await cdn.get(`${accountId}.sdk.json`)) ?? 'null') as SdkPart | null;
    return s && { flags: s.flags ?? [], experiments: s.experiments ?? [] };
  } catch {
    return null;
  }
}

/**
 * Compila os experimentos EM EXECUÇÃO da conta num JSON versionado, registra a publicação (só inserção)
 * e grava `/cdn/<conta>.json` + `/cdn/<conta>.js`. customJS novo ou alterado exige permissão.
 */
export function createPublisher(deps: PublisherDeps) {
  const run = publisher(deps);
  // Uma publicação por conta de cada vez: duas simultâneas leriam o banco antes e a mais lenta gravaria a
  // config velha por cima da nova. ponytail: só dentro do processo/isolate; entre isolates do Worker
  // continua valendo a última gravação (fila ou Durable Object se virar problema).
  const queue = new Map<string, Promise<unknown>>();
  return (accountId: string, user: User) => {
    const p = (queue.get(accountId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => run(accountId, user));
    queue.set(accountId, p);
    void p.finally(() => queue.get(accountId) === p && queue.delete(accountId)).catch(() => undefined);
    return p;
  };
}

function publisher({ repo, cdn, publicUrl, heatmapSampleRate = 0 }: PublisherDeps) {
  return async (accountId: string, user: User): Promise<PublishResult> => {
    const [
      all,
      last,
      settings,
      audiences,
      popupList,
      surveyList,
      recoList,
      flags,
      integ,
      predCfg,
      pred,
      cons,
      groups,
    ] = await Promise.all([
      repo.loadAllExperiments(accountId),
      repo.lastPublication(accountId),
      repo.getAccountSettings(accountId),
      repo.listEntities<Audience>(accountId, 'audience'),
      repo.listEntities<Popup>(accountId, 'popup'),
      repo.listEntities<Survey>(accountId, 'survey'),
      repo.listEntities<RecoWidget>(accountId, 'reco'),
      repo.listEntities<Flag>(accountId, 'flag'),
      repo.listEntities<Integrations>(accountId, 'integrations'),
      repo.listEntities<PropensityConfig>(accountId, 'propensity'),
      repo.listEntities<TrainedModel>(accountId, MODEL_KIND),
      repo.listEntities<Consent>(accountId, 'consent'),
      repo.listEntities<Group>(accountId, 'group'),
    ]);
    const consent = cons[0]?.data;
    const recos = recoList.filter((r) => r.data.status === 'running');
    const surveys = surveyList.filter((s) => s.data.status === 'running');
    const popups = popupList.filter((p) => p.data.status === 'running');
    const sampleRate = settings.heatmapSampleRate ?? heatmapSampleRate;
    // Grupos exclusivos (17.1): cada experimento leva o id do grupo e as fatias dele. Sobrescreve sempre, então
    // um `group` vindo do cliente no experimento nunca chega ao site.
    const slotsOf = new Map<string, Experiment['group']>();
    for (const g of groups)
      g.data.slots?.forEach((owner, i) => {
        const cur = slotsOf.get(owner) ?? { id: g.id, slots: [] };
        // Em dois grupos (gravações simultâneas passaram a checagem): vale o primeiro.
        if (!owner || cur.id !== g.id) return;
        cur.slots.push(i);
        slotsOf.set(owner, cur);
      });
    const running = all
      .filter((e) => e.status === 'running')
      .map((e) => ({ ...e, group: slotsOf.get(e.id) }));

    if (!canPublishJs(user)) {
      const published = jsOf(last?.config.experiments ?? []);
      const changed = [...jsOf(running)].filter(([id, js]) => published.get(id) !== js);
      if (changed.length)
        return { status: 403, error: 'publicar JavaScript customizado exige permissão (peça a um owner)' };
    }

    const config: PublishedConfig = PublishedConfigSchema.parse({
      accountId,
      version: (last?.version ?? 0) + 1,
      publishedAt: new Date().toISOString(),
      apiUrl: publicUrl,
      trackingUrl: `${publicUrl}/collect`,
      experiments: running,
      // Só as audiências usadas por experimentos publicados (o resto não precisa ir para o site).
      audiences: audiences
        .filter(
          (a) =>
            running.some((e) => e.audiences.includes(a.id)) ||
            popups.some((p) => p.data.targeting.audiences.includes(a.id)) ||
            surveys.some((s) => s.data.targeting.audiences.includes(a.id)) ||
            recos.some((r) => r.data.targeting.audiences.includes(a.id)),
        )
        .map((a) => ({ id: a.id, ...a.data })),
      ...(popups.length ? { popups: popups.map((p) => ({ id: p.id, name: p.name, ...p.data })) } : {}),
      ...(surveys.length ? { surveys: surveys.map((s) => ({ id: s.id, name: s.name, ...s.data })) } : {}),
      ...(recos.length ? { recos: recos.map((r) => ({ id: r.id, name: r.name, ...r.data })) } : {}),
      ...(integ[0] && (integ[0].data.ga4 || integ[0].data.gtm) ? { integrations: integ[0].data } : {}),
      ...(consent?.required
        ? {
            consent: {
              ...(consent.cmp !== 'none' ? { cmp: consent.cmp } : {}),
              ...(consent.category ? { category: consent.category } : {}),
            },
          }
        : {}),
      ...(predCfg[0]?.data.enabled && pred[0]
        ? { propensity: { goal: pred[0].data.goal, w: pred[0].data.w, b: pred[0].data.b } }
        : {}),
      ...(sampleRate > 0 ? { heatmap: { sampleRate, recordings: true, forms: true } } : {}),
    });
    // SDK server-side: flags + campanhas server-side, num arquivo próprio (o site não precisa dele).
    const sdk: SdkConfig = {
      accountId,
      version: config.version,
      publishedAt: config.publishedAt,
      trackingUrl: config.trackingUrl,
      flags: flags.map((f) => f.data),
      experiments: running
        .filter((e) => e.type === 'server')
        .map(({ id, key, traffic, variations, goals, group }) => ({
          id,
          key,
          traffic,
          variations,
          goals,
          group,
        })),
    };
    // Aprovação (fase 16.4): quem não pode aprovar só republica o que já foi aprovado (D-072).
    if (settings.requireApproval && !canPublishJs(user)) {
      const auto = new Set(
        [...running, ...(last?.config.experiments ?? [])]
          .filter((e) => e.allocation !== 'manual')
          .map((e) => e.id),
      );
      const prev = last ? await lastSdk(cdn, accountId) : null;
      if (!last || reviewable(config, sdk, auto) !== reviewable(last.config, prev, auto))
        return { status: 403, error: APPROVAL_ERROR, needsApproval: true };
    }
    await Promise.all([
      repo.insertPublication(accountId, config, user.id),
      writeAccountFiles(cdn, config),
      cdn.put(`${accountId}.sdk.json`, JSON.stringify(sdk)),
      // Vitrine no ar precisa do modelo na CDN antes do primeiro visitante.
      recos.length ? rebuildReco(repo, cdn, accountId) : null,
    ]);
    return { version: config.version };
  };
}
