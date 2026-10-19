import { PublishedConfigSchema, type Audience, type Experiment, type PublishedConfig } from '@abtest/shared';
import { canPublishJs } from './auth';
import { writeAccountFiles, type CdnStore } from './cdn';
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
    const [all, last, settings, audiences] = await Promise.all([
      repo.loadAllExperiments(accountId),
      repo.lastPublication(accountId),
      repo.getAccountSettings(accountId),
      repo.listEntities<Audience>(accountId, 'audience'),
    ]);
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
        .filter((a) => running.some((e) => e.audiences.includes(a.id)))
        .map((a) => ({ id: a.id, ...a.data })),
      ...(sampleRate > 0 ? { heatmap: { sampleRate, recordings: true, forms: true } } : {}),
    });
    await Promise.all([repo.insertPublication(accountId, config, user.id), writeAccountFiles(cdn, config)]);
    return { version: config.version };
  };
}
