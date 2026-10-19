import {
  PublishedConfigSchema,
  type Audience,
  type Experiment,
  type Flag,
  type SdkConfig,
  type Popup,
  type RecoWidget,
  type Survey,
  type PublishedConfig,
} from '@abtest/shared';
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

/**
 * Compila os experimentos EM EXECUÇÃO da conta num JSON versionado, registra a publicação (só inserção)
 * e grava `/cdn/<conta>.json` + `/cdn/<conta>.js`. customJS novo ou alterado exige permissão.
 */
export function createPublisher({ repo, cdn, publicUrl, heatmapSampleRate = 0 }: PublisherDeps) {
  return async (
    accountId: string,
    user: User,
  ): Promise<{ version: number } | { error: string; status: 403 | 400 }> => {
    const [all, last, settings, audiences, popupList, surveyList, recoList, flags] = await Promise.all([
      repo.loadAllExperiments(accountId),
      repo.lastPublication(accountId),
      repo.getAccountSettings(accountId),
      repo.listEntities<Audience>(accountId, 'audience'),
      repo.listEntities<Popup>(accountId, 'popup'),
      repo.listEntities<Survey>(accountId, 'survey'),
      repo.listEntities<RecoWidget>(accountId, 'reco'),
      repo.listEntities<Flag>(accountId, 'flag'),
    ]);
    const recos = recoList.filter((r) => r.data.status === 'running');
    const surveys = surveyList.filter((s) => s.data.status === 'running');
    const popups = popupList.filter((p) => p.data.status === 'running');
    const sampleRate = settings.heatmapSampleRate ?? heatmapSampleRate;
    const running = all.filter((e) => e.status === 'running');

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
        .map(({ id, key, traffic, variations, goals }) => ({ id, key, traffic, variations, goals })),
    };
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
