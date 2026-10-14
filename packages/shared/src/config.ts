import { z } from 'zod';
import { ExperimentSchema } from './experiment';

/** JSON publicado na CDN por conta (`/cdn/<accountId>.json`). Só experimentos em execução. */
export const PublishedConfigSchema = z.object({
  accountId: z.string().min(1),
  version: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  /** Endpoint que recebe eventos (o adaptador padrão faz POST via sendBeacon). */
  trackingUrl: z.string().optional(),
  /** Base da API (o snippet valida tokens de edição em `${apiUrl}/edit-sessions/:token`). */
  apiUrl: z.string().optional(),
  experiments: z.array(ExperimentSchema),
});
export type PublishedConfig = z.infer<typeof PublishedConfigSchema>;
