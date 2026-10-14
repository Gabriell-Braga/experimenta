import { PublishedConfigSchema, type Experiment, type PublishedConfig } from '@abtest/shared';
import { canPublishJs } from './auth';
import { writeAccountFiles } from './cdn';
import type { Repo, User } from './repo';

export interface PublisherDeps {
  repo: Repo;
  cdnDir: string;
  /** URL pública da API (validação de sessões de edição e coleta de eventos). */
  publicUrl: string;
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
export function createPublisher({ repo, cdnDir, publicUrl }: PublisherDeps) {
  return async (
    accountId: string,
    user: User,
  ): Promise<{ version: number } | { error: string; status: 403 | 400 }> => {
    const running = (await repo.loadAllExperiments(accountId)).filter((e) => e.status === 'running');
    const last = await repo.lastPublication(accountId);

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
    });
    await repo.insertPublication(accountId, config, user.id);
    writeAccountFiles(cdnDir, config);
    return { version: config.version };
  };
}
