import { z } from 'zod';

// Sincronização dos perfis do CDP com CRMs (fase 19.1, D-089): HubSpot e Salesforce, por e-mail.

/** Dados do perfil do CDP que podem ir para o CRM. Atributo do site = `attr.<nome>`. */
export const CRM_SOURCES = {
  segments: 'Segmentos do CDP (nomes separados por ;)',
  experiments: 'Testes e variações (teste:variação;…)',
  sessions: 'Sessões',
  pageviews: 'Páginas vistas',
  conversions: 'Conversões',
  revenue: 'Receita',
  firstSeen: 'Primeira visita (data e hora)',
  lastSeen: 'Última visita (data e hora)',
  devices: 'Dispositivos',
} as const;
export type CrmSource = keyof typeof CRM_SOURCES;

export const CrmFieldSchema = z.object({
  from: z
    .string()
    .trim()
    .refine((s) => s in CRM_SOURCES || /^attr\.[\w.-]{1,60}$/.test(s), 'origem inválida'),
  /** Propriedade no CRM (precisa existir lá; no Salesforce, campo personalizado termina em `__c`). */
  to: z
    .string()
    .trim()
    .regex(/^[A-Za-z][\w]{0,99}$/, 'campo do CRM: letras, números e _'),
});
export type CrmField = z.infer<typeof CrmFieldSchema>;
const Fields = z.array(CrmFieldSchema).max(30);

export const HubspotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Token do app privado (escopo crm.objects.contacts.write). Só escrita: nunca volta na API. */
  token: z.string().max(500).optional(),
  fields: Fields.default([]),
});
export const SalesforceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Domínio da org (`https://minhaempresa.my.salesforce.com`). */
  instanceUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (u) => u === '' || /^https:\/\/[a-z0-9.-]+\.(salesforce|force)\.com\/?$/i.test(u),
      'use o domínio da org: https://<empresa>.my.salesforce.com',
    )
    .default(''),
  /** App conectado com fluxo client credentials. O segredo é só escrita. */
  clientId: z.string().trim().max(300).default(''),
  clientSecret: z.string().max(500).optional(),
  object: z.enum(['Contact', 'Lead']).default('Contact'),
  /** Campo de ID externo com o e-mail (ex.: `Email_Externo__c`, marcado como External ID e único). */
  externalIdField: z
    .string()
    .trim()
    .regex(/^([A-Za-z][\w]{0,99})?$/, 'campo: letras, números e _')
    .default(''),
  fields: Fields.default([]),
});
export const CrmConfigSchema = z.object({
  hubspot: HubspotConfigSchema.prefault({}),
  salesforce: SalesforceConfigSchema.prefault({}),
});
export type CrmConfig = z.infer<typeof CrmConfigSchema>;
export type CrmProvider = keyof CrmConfig;

/** Campos sugeridos (precisam ser criados no CRM com estes nomes). */
export const CRM_DEFAULT_FIELDS: Record<CrmProvider, CrmField[]> = {
  hubspot: [
    { from: 'segments', to: 'abt_segments' },
    { from: 'experiments', to: 'abt_experiments' },
    { from: 'sessions', to: 'abt_sessions' },
    { from: 'conversions', to: 'abt_conversions' },
    { from: 'revenue', to: 'abt_revenue' },
    { from: 'lastSeen', to: 'abt_last_seen' },
  ],
  salesforce: [
    { from: 'segments', to: 'Abt_Segments__c' },
    { from: 'experiments', to: 'Abt_Experiments__c' },
    { from: 'sessions', to: 'Abt_Sessions__c' },
    { from: 'conversions', to: 'Abt_Conversions__c' },
    { from: 'revenue', to: 'Abt_Revenue__c' },
    { from: 'lastSeen', to: 'Abt_Last_Seen__c' },
  ],
};

/** Situação da última sincronização de um CRM (o que a tela mostra). */
export interface CrmStatus {
  at?: string;
  ok?: boolean;
  /** Perfis enviados na última execução e no total desde a última mudança de configuração. */
  sent: number;
  total: number;
  failed: number;
  /** Perfis com e-mail ainda por enviar (mudaram depois do cursor). */
  remaining: number;
  errors: string[];
}
