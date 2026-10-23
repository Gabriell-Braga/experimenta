import { z } from 'zod';
import { UrlRuleSchema } from './experiment';

/**
 * Entidades de configuração dos módulos, guardadas na tabela genérica `entities` (D-049).
 * Cada tipo tem seu schema; a API valida `data` por `kind` antes de gravar.
 */

/** Passo de funil: página visitada (regra de URL) ou evento customizado. */
export const FunnelStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), name: z.string().min(1).max(80), url: UrlRuleSchema }),
  z.object({ type: z.literal('event'), name: z.string().min(1).max(80), event: z.string().min(1).max(100) }),
]);
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

export const FunnelSchema = z.object({
  steps: z.array(FunnelStepSchema).min(2).max(12),
  /** Prazo para completar o funil a partir do 1º passo. */
  windowDays: z.number().int().min(1).max(90).default(7),
});
export type Funnel = z.infer<typeof FunnelSchema>;

const Text = z.object({
  op: z.enum(['eq', 'neq', 'contains', 'regex', 'exists']),
  value: z.string().default(''),
});
const Num = z.object({ op: z.enum(['gte', 'lte', 'eq']), value: z.number() });

/**
 * Regra de audiência, avaliada no navegador pelo snippet (sem ida ao servidor). Comportamento vem do perfil
 * local do visitante (páginas vistas, sessões, eventos, páginas visitadas, origem da 1ª visita, atributos).
 */
export const AudienceRuleSchema = z.discriminatedUnion('type', [
  /** Site de origem desta visita (`document.referrer`); vazio = acesso direto. */
  z.object({ type: z.literal('referrer'), ...Text.shape }),
  /** Parâmetro UTM da 1ª visita (first-touch) ou da URL atual. */
  z.object({
    type: z.literal('utm'),
    param: z.enum(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']),
    ...Text.shape,
  }),
  /** Atributo do visitante (`abq.push(['identify'|'set', …])`). */
  z.object({
    type: z.literal('attribute'),
    key: z.string().min(1),
    op: z.enum(['eq', 'neq', 'contains', 'exists', 'gte', 'lte']),
    value: z.string().default(''),
  }),
  z.object({ type: z.literal('pageviews'), ...Num.shape }),
  z.object({ type: z.literal('sessions'), ...Num.shape }),
  /** Quantas vezes fez o evento customizado. */
  z.object({ type: z.literal('event'), name: z.string().min(1), ...Num.shape }),
  /** Já visitou uma página (caminho contém). */
  z.object({ type: z.literal('visited'), value: z.string().min(1), negate: z.boolean().default(false) }),
  z.object({ type: z.literal('cookie'), name: z.string().min(1), ...Text.shape }),
  /** Variável global da página (ex.: `dataLayer.0.plano`, `usuario.tipo`). */
  z.object({ type: z.literal('js'), path: z.string().min(1), ...Text.shape }),
  /** Idioma do navegador (prefixo, ex.: `pt`, `en-US`). */
  z.object({ type: z.literal('language'), value: z.string().min(1) }),
  /** Horário local do visitante: horas [from, to) e dias da semana (0 = domingo). */
  z.object({
    type: z.literal('time'),
    from: z.number().int().min(0).max(23).default(0),
    to: z.number().int().min(1).max(24).default(24),
    days: z.array(z.number().int().min(0).max(6)).default([]),
  }),
  z.object({ type: z.literal('device'), value: z.enum(['desktop', 'tablet', 'mobile']) }),
  z.object({ type: z.literal('visitor'), value: z.enum(['new', 'returning']) }),
  /** Score preditivo de propensão a converter (0..1, fase 15.3). */
  z.object({ type: z.literal('score'), ...Num.shape }),
]);
export type AudienceRule = z.infer<typeof AudienceRuleSchema>;

export const AudienceSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(AudienceRuleSchema).min(1).max(30),
});
export type Audience = z.infer<typeof AudienceSchema>;

/** Quando um pop-up/pesquisa aparece. */
export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load') }),
  z.object({ type: z.literal('delay'), seconds: z.number().min(0).max(600).default(5) }),
  z.object({ type: z.literal('scroll'), percent: z.number().min(1).max(100).default(50) }),
  /** Mouse saindo pelo topo da janela (desktop) ou "voltar" rápido no celular. */
  z.object({ type: z.literal('exit') }),
  z.object({ type: z.literal('inactive'), seconds: z.number().min(1).max(600).default(20) }),
  z.object({ type: z.literal('click'), selector: z.string().min(1) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

/** Onde e para quem: páginas, dispositivos e audiências (todas). */
export const EngageTargetingSchema = z.object({
  urls: z.array(UrlRuleSchema).default([]),
  devices: z.array(z.enum(['desktop', 'tablet', 'mobile'])).default([]),
  audiences: z.array(z.string()).default([]),
});

const engageBase = {
  status: z.enum(['draft', 'running', 'paused']).default('draft'),
  trigger: TriggerSchema.default({ type: 'delay', seconds: 5 }),
  targeting: EngageTargetingSchema.default({}),
  /** Quantas vezes mostrar ao mesmo visitante. */
  frequency: z.enum(['once', 'session', 'always']).default('once'),
};

/** Pop-up, barra ou slide-in com chamada para ação (Campaign Management). */
export const PopupSchema = z.object({
  ...engageBase,
  format: z.enum(['modal', 'bar-top', 'bar-bottom', 'slide-in']).default('modal'),
  title: z.string().max(140).default(''),
  body: z.string().max(600).default(''),
  image: z.string().url().optional(),
  cta: z.object({ label: z.string().min(1).max(60), url: z.string().optional() }).optional(),
  /** Código exibido com botão de copiar (ex.: cupom). */
  code: z.string().max(40).optional(),
  theme: z.enum(['light', 'dark', 'brand']).default('light'),
  /** Cor de destaque (botão). */
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#16181d'),
});
export type Popup = z.infer<typeof PopupSchema>;

/** Pergunta de pesquisa. `logic`: depois de responder, pula para outra pergunta (ou encerra) conforme a resposta. */
export const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(['nps', 'csat', 'ces', 'rating', 'choice', 'multi', 'text']),
  text: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).max(12).default([]),
  required: z.boolean().default(true),
  logic: z
    .array(
      z.object({
        /** Nota (nps/csat/ces/rating) ou opção escolhida (choice). */
        op: z.enum(['eq', 'lte', 'gte']),
        value: z.union([z.number(), z.string()]),
        goto: z.string(),
      }),
    )
    .default([]),
});
export type Question = z.infer<typeof QuestionSchema>;

/** Pesquisa no site (Feedback: NPS, CSAT, CES, múltipla escolha, texto livre). */
export const SurveySchema = z.object({
  ...engageBase,
  format: z.enum(['slide-in', 'modal']).default('slide-in'),
  questions: z.array(QuestionSchema).min(1).max(15),
  thankYou: z.string().max(200).default('Obrigado pela resposta!'),
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#16181d'),
});
export type Survey = z.infer<typeof SurveySchema>;

/** Vitrine de recomendações inserida numa posição da página. */
export const RecoWidgetSchema = z.object({
  status: z.enum(['draft', 'running', 'paused']).default('draft'),
  strategy: z.enum(['coview', 'copurchase', 'upsell', 'nbo', 'trending', 'bestsellers']).default('coview'),
  title: z.string().max(80).default('Você também pode gostar'),
  /** Onde inserir: seletor do elemento de referência e posição relativa a ele. */
  selector: z.string().min(1),
  position: z.enum(['before', 'after', 'prepend', 'append']).default('after'),
  limit: z.number().int().min(1).max(12).default(4),
  targeting: EngageTargetingSchema.default({}),
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#16181d'),
});
export type RecoWidget = z.infer<typeof RecoWidgetSchema>;

/**
 * Segmento do CDP: regras sobre o PERFIL unificado (todos os dispositivos), avaliadas no servidor. Serve para
 * análise, exportação (CSV/API) e decisões cross-channel — diferente da audiência, avaliada no navegador.
 */
export const SegmentRuleSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.enum([
      'sessions',
      'pageviews',
      'events',
      'conversions',
      'revenue',
      'devices',
      'lastSeenDays',
      'firstSeenDays',
    ]),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.number(),
  }),
  z.object({
    field: z.literal('event'),
    name: z.string().min(1),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.number(),
  }),
  z.object({
    field: z.literal('attribute'),
    key: z.string().min(1),
    op: z.enum(['eq', 'neq', 'contains', 'exists']),
    value: z.string().default(''),
  }),
  z.object({ field: z.literal('identified'), value: z.boolean() }),
  z.object({ field: z.literal('device'), value: z.enum(['desktop', 'tablet', 'mobile']) }),
  z.object({ field: z.literal('experiment'), key: z.string().min(1), variation: z.string().default('') }),
]);
export type SegmentRule = z.infer<typeof SegmentRuleSchema>;
export const SegmentSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(SegmentRuleSchema).min(1).max(30),
});
export type Segment = z.infer<typeof SegmentSchema>;

/**
 * Feature flag: ligada/desligada, liberada para uma fração dos usuários (rollout determinístico por usuário),
 * com regras de atributo (todas precisam bater) e variáveis entregues quando ativa. Avaliada pelo SDK.
 */
export const FlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-_.]*$/, 'use minúsculas, números, - _ .'),
  description: z.string().max(300).default(''),
  enabled: z.boolean().default(false),
  rollout: z.number().min(0).max(100).default(100),
  rules: z
    .array(
      z.object({
        attribute: z.string().min(1),
        op: z.enum(['eq', 'neq', 'in', 'contains', 'gte', 'lte']),
        /** `in`: valores separados por vírgula. */
        value: z.string(),
      }),
    )
    .default([]),
  variables: z.record(z.unknown()).default({}),
});
export type Flag = z.infer<typeof FlagSchema>;

/** Tipos de evento que podem disparar webhook. */
export const WEBHOOK_EVENTS = [
  'conversion',
  'survey',
  'form',
  'engage',
  'identify',
  'event',
  'publish',
  'approval',
  'mention',
] as const;

/** Webhook: POST JSON assinado (HMAC-SHA256 em `X-Abt-Signature`) para cada evento escolhido. */
export const WebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  enabled: z.boolean().default(true),
  /** Gerado pela API quando vazio; o destino valida a assinatura com ele. */
  secret: z.string().default(''),
});
export type Webhook = z.infer<typeof WebhookSchema>;

/** Ferramenta de analytics com `window.<global>.track(nome, props)` (Segment, Mixpanel, Amplitude). */
const TrackToolSchema = z.object({
  enabled: z.boolean().default(false),
  /** Nome do evento de exposição ('' = padrão da ferramenta, ver `TRACK_TOOLS`). */
  exposureEvent: z.string().trim().max(80).default(''),
  /** Também envia as conversões das metas (evento `conversionEvent`, '' = padrão). */
  conversions: z.boolean().default(true),
  conversionEvent: z.string().trim().max(80).default(''),
});
export type TrackTool = z.infer<typeof TrackToolSchema>;

/** Integrações nativas no navegador (compiladas para a config publicada por `compileIntegrations`). */
export const IntegrationsSchema = z.object({
  /** Envia `experiment_impression` para o GA4 (gtag) a cada exposição. */
  ga4: z.boolean().default(false),
  /** Empurra `abt_exposure` / `abt_conversion` no dataLayer do Google Tag Manager. */
  gtm: z.boolean().default(false),
  segment: TrackToolSchema.default({}),
  mixpanel: TrackToolSchema.default({}),
  amplitude: TrackToolSchema.default({}),
});
export type Integrations = z.infer<typeof IntegrationsSchema>;

/**
 * Padrões de cada ferramenta: objeto global do site, eventos e nomes das propriedades. Segment segue a
 * especificação "Experiment Viewed"; Mixpanel usa `$experiment_started` com "Experiment name"/"Variant name"
 * (relatório de experimentos dele); Amplitude usa o mesmo formato do Segment.
 */
export const TRACK_TOOLS = {
  segment: {
    label: 'Segment',
    global: 'analytics',
    exposure: 'Experiment Viewed',
    conversion: 'Experiment Converted',
    keys: ['experiment_id', 'variation_id', 'goal'],
  },
  mixpanel: {
    label: 'Mixpanel',
    global: 'mixpanel',
    exposure: '$experiment_started',
    conversion: 'Experiment Converted',
    keys: ['Experiment name', 'Variant name', 'Goal'],
  },
  amplitude: {
    label: 'Amplitude',
    global: 'amplitude',
    exposure: 'Experiment Viewed',
    conversion: 'Experiment Converted',
    keys: ['experiment_id', 'variation_id', 'goal'],
  },
} as const;
export type TrackToolName = keyof typeof TRACK_TOOLS;

/**
 * Destino publicado no snippet: `[global, evento de exposição, evento de conversão ('' = não envia), chave do
 * experimento, da variação, da meta]`. `gtag` chama `gtag('event', nome, props)`, `dataLayer` faz
 * `dataLayer.push({ event: nome, ...props })` e o resto `window[global].track(nome, props)`. O runtime só
 * despacha: nomes e formatos ficam na config (D-089).
 */
export const IntegrationTargetSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);
export type IntegrationTarget = z.infer<typeof IntegrationTargetSchema>;

/** Integrações ligadas → destinos do snippet. Aceita o formato antigo (`{ ga4, gtm }`) das configs já publicadas. */
export function compileIntegrations(raw: unknown): IntegrationTarget[] {
  const r = IntegrationsSchema.safeParse(raw);
  if (!r.success) return [];
  const ig = r.data;
  const out: IntegrationTarget[] = [];
  if (ig.ga4) out.push(['gtag', 'experiment_impression', '', 'experiment_id', 'variant_id', 'goal']);
  if (ig.gtm)
    out.push(['dataLayer', 'abt_exposure', 'abt_conversion', 'abt_experiment', 'abt_variation', 'abt_goal']);
  for (const name of Object.keys(TRACK_TOOLS) as TrackToolName[]) {
    const t = ig[name];
    const d = TRACK_TOOLS[name];
    if (t.enabled)
      out.push([
        d.global,
        t.exposureEvent || d.exposure,
        t.conversions ? t.conversionEvent || d.conversion : '',
        ...d.keys,
      ]);
  }
  return out;
}

/** Banners de consentimento (CMP) que o snippet sabe ler sozinho. */
export const CONSENT_CMPS = ['onetrust', 'cookiebot', 'gcm'] as const;

/** Consentimento LGPD/GDPR (publicado na config quando `required`). */
export const ConsentSchema = z.object({
  /**
   * Esperar consentimento: nada de cookies, testes nem coleta até `abq.push(['consent', true])` ou o CMP.
   * Ligado por padrão (privacidade por padrão, D-099): conta sem a escolha salva publica esperando.
   */
  required: z.boolean().default(true),
  /** CMP lido automaticamente (`none` = o site chama `abq.push(['consent', …])`). */
  cmp: z.enum(['none', ...CONSENT_CMPS]).default('none'),
  /** Categoria do CMP (vazio = padrão: OneTrust `C0002`, Cookiebot `statistics`, Google `analytics_storage`). */
  category: z
    .string()
    .trim()
    .max(60)
    .regex(/^[\w-]*$/, 'categoria: só letras, números, _ e -')
    .default(''),
});
export type Consent = z.infer<typeof ConsentSchema>;

/** Analytics preditivo: qual evento prever e em quantos dias. O modelo treinado fica em `propensity-model`. */
export const PropensityConfigSchema = z.object({
  goal: z.string().min(1).max(100),
  horizonDays: z.number().int().min(1).max(30).default(7),
  enabled: z.boolean().default(true),
});
export type PropensityConfig = z.infer<typeof PropensityConfigSchema>;

/** Fatias de tráfego de um grupo mutuamente exclusivo (1 fatia = 1% dos visitantes). */
export const GROUP_SLOTS = 100;

/**
 * Grupo mutuamente exclusivo (fase 17.1): os experimentos dividem o tráfego do grupo e o visitante cai em no
 * máximo um. `percent` = fatia do grupo de cada experimento; `slots` (dono de cada fatia, '' = livre) é
 * calculado pela API ao salvar (`allocateSlots`), nunca vem do cliente.
 */
export const GroupSchema = z.object({
  description: z.string().trim().max(500).default(''),
  experiments: z
    .array(z.object({ id: z.string().min(1).max(100), percent: z.number().int().min(1).max(GROUP_SLOTS) }))
    .max(GROUP_SLOTS)
    .default([])
    .superRefine((list, ctx) => {
      if (new Set(list.map((e) => e.id)).size !== list.length)
        ctx.addIssue({ code: 'custom', message: 'experimento repetido no grupo' });
      if (list.reduce((s, e) => s + e.percent, 0) > GROUP_SLOTS)
        ctx.addIssue({ code: 'custom', message: 'a soma das fatias passa de 100%' });
    }),
  slots: z.array(z.string()).length(GROUP_SLOTS).optional(),
});
export type Group = z.infer<typeof GroupSchema>;

/**
 * Distribui as fatias do grupo mexendo o mínimo na alocação anterior: cada experimento mantém as fatias que já
 * tinha (se diminuiu, perde as do fim), quem saiu libera as suas e quem cresceu ou entrou pega as livres de
 * menor índice. Assim só muda de experimento quem estava na diferença.
 */
export function allocateSlots(prev: readonly string[] | undefined, exps: Group['experiments']): string[] {
  const want = new Map(exps.map((e) => [e.id, e.percent]));
  const have = new Map<string, number>();
  const slots = Array.from({ length: GROUP_SLOTS }, (_, i) => {
    const id = prev?.[i] ?? '';
    const n = have.get(id) ?? 0;
    if (!id || n >= (want.get(id) ?? 0)) return '';
    have.set(id, n + 1);
    return id;
  });
  for (const e of exps)
    for (let i = 0, n = have.get(e.id) ?? 0; i < GROUP_SLOTS && n < e.percent; i++)
      if (!slots[i]) {
        slots[i] = e.id;
        n++;
      }
  return slots;
}

export const ENTITY_SCHEMAS = {
  funnel: FunnelSchema,
  audience: AudienceSchema,
  popup: PopupSchema,
  survey: SurveySchema,
  reco: RecoWidgetSchema,
  segment: SegmentSchema,
  flag: FlagSchema,
  webhook: WebhookSchema,
  integrations: IntegrationsSchema,
  consent: ConsentSchema,
  propensity: PropensityConfigSchema,
  group: GroupSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
export type EntityKind = keyof typeof ENTITY_SCHEMAS;
