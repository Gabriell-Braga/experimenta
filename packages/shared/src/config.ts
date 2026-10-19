import { z } from 'zod';
import { AudienceSchema, PopupSchema, RecoWidgetSchema, SurveySchema } from './entities';
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
  /** Audiências usadas pelos experimentos publicados (avaliadas no navegador). */
  audiences: z.array(AudienceSchema.extend({ id: z.string() })).optional(),
  /** Engajamento (engage.js): pop-ups em execução. */
  popups: z.array(PopupSchema.extend({ id: z.string(), name: z.string() })).optional(),
  surveys: z.array(SurveySchema.extend({ id: z.string(), name: z.string() })).optional(),
  /** Vitrines de recomendação (modelo em `<conta>.reco.json` na mesma pasta). */
  recos: z.array(RecoWidgetSchema.extend({ id: z.string(), name: z.string() })).optional(),
  /** Mapa de calor: fração de visitantes amostrados (0 = desligado). */
  heatmap: z
    .object({
      sampleRate: z.number().min(0).max(1),
      /** Visitantes amostrados também têm a sessão gravada e os formulários medidos (insights.js). */
      recordings: z.boolean().optional(),
      forms: z.boolean().optional(),
    })
    .optional(),
});
export type PublishedConfig = z.infer<typeof PublishedConfigSchema>;
