import { z } from 'zod';

// Exportação agendada de dados (fase 19.4, D-092): eventos brutos (incremental) e/ou relatórios dos testes,
// diária ou semanal, para CSV (baixar no editor), S3 e compatíveis (R2, GCS) ou BigQuery.

export const EXPORT_DESTINATIONS = ['csv', 's3', 'bigquery'] as const;
export type ExportDestination = (typeof EXPORT_DESTINATIONS)[number];
/** Eventos do mapa de calor: volumosos, só vão com `heatmap`. */
export const HEATMAP_EVENT_TYPES = ['click', 'move', 'scroll'];

export const S3ExportSchema = z.object({
  /** Vazio = AWS (`https://s3.<região>.amazonaws.com`). R2: `https://<conta>.r2.cloudflarestorage.com`. */
  endpoint: z
    .string()
    .trim()
    .max(300)
    .refine(
      (u) => u === '' || /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(u),
      'endpoint: https://host, sem caminho',
    )
    .default(''),
  /** R2 e GCS aceitam `auto`. */
  region: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, 'região: letras minúsculas, números e -')
    .default('us-east-1'),
  bucket: z
    .string()
    .trim()
    .regex(/^([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])?$/, 'bucket: 3 a 63 letras minúsculas, números, . e -')
    .default(''),
  /** Pasta dentro do bucket. */
  prefix: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\w.=/-]*$/, 'pasta: letras, números, _ - . = /')
    .default('experimenta/'),
  accessKeyId: z.string().trim().max(200).default(''),
  /** Só escrita: nunca volta na API. */
  secretAccessKey: z.string().max(500).optional(),
});

export const BigQueryExportSchema = z.object({
  projectId: z
    .string()
    .trim()
    .regex(/^([a-z][a-z0-9:.-]{4,62}[a-z0-9])?$/, 'projeto: id do projeto do Google Cloud')
    .default(''),
  dataset: z
    .string()
    .trim()
    .regex(/^\w{0,1024}$/, 'dataset: letras, números e _')
    .default(''),
  eventsTable: z
    .string()
    .trim()
    .regex(/^[\w-]{1,1024}$/, 'tabela: letras, números, _ e -')
    .default('events'),
  reportsTable: z
    .string()
    .trim()
    .regex(/^[\w-]{1,1024}$/, 'tabela: letras, números, _ e -')
    .default('experiment_reports'),
  /** JSON da chave da conta de serviço (papel BigQuery Data Editor). Só escrita. */
  serviceAccount: z.string().max(10_000).optional(),
});

export const ExportConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Eventos brutos novos desde a última exportação. */
  events: z.boolean().default(true),
  /** Incluir cliques, movimentos e rolagem do mapa de calor. */
  heatmap: z.boolean().default(false),
  /** Relatório (visitantes, conversões, melhoria, chance de vencer) dos testes em execução. */
  reports: z.boolean().default(false),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  /** Hora UTC. */
  hour: z.number().int().min(0).max(23).default(3),
  /** Dia da semana (0 = domingo), só na semanal. */
  weekday: z.number().int().min(0).max(6).default(1),
  destination: z.enum(EXPORT_DESTINATIONS).default('csv'),
  s3: S3ExportSchema.default({}),
  bigquery: BigQueryExportSchema.default({}),
});
export type ExportConfig = z.infer<typeof ExportConfigSchema>;

/** Próxima execução estritamente depois de `after` (ms), na hora UTC da configuração. */
export function nextExportAt(c: Pick<ExportConfig, 'frequency' | 'hour' | 'weekday'>, after: number): number {
  const d = new Date(after);
  d.setUTCHours(c.hour, 0, 0, 0);
  while (d.getTime() <= after || (c.frequency === 'weekly' && d.getUTCDay() !== c.weekday))
    d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}
