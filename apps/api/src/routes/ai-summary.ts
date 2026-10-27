import { createRoute, z } from '@hono/zod-openapi';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_SUMMARY_KINDS,
  HeatmapContextSchema,
  ReportNumbersSchema,
  type AiSummaryKind,
  type Survey,
} from '@abtest/shared';
import { AI_MODEL, type CompatAi } from '../ai';
import { checkReport, reportInput, ruleReport, type ReportInput } from '../ai-report';
import {
  claudeSummary,
  compatSummary,
  heatmapInput,
  recordingInput,
  ruleSurvey,
  SURVEY_SAMPLE,
  surveyInput,
  type AnySummary,
} from '../ai-summary';
import { behavior } from '../analytics/behavior';
import { forbid, hasRole } from '../auth';
import { sha256hex } from '../crypto';
import { errors, json, security, type Api } from '../http';
import { normalizePage, type Repo } from '../repo';

/** Cache dos resumos: uma entidade por alvo (`name` = chave), as mais recentes da conta. */
const KIND = 'ai-summary';
const MAX_CACHED = 50;
/** Resumo vale no máximo isto, mesmo sem dado novo. */
const TTL_MS = 7 * 86_400_000;
/** Dado novo dentro disto não gera de novo sozinho (devolve o guardado com `stale`; "Atualizar" força). */
const FRESH_MS = 3_600_000;
/** Muda quando o prompt ou o formato da entrada mudar (invalida o cache). */
const PROMPT_VERSION = 1;

type Source = 'claude' | 'modelo' | 'regras';
interface Cached {
  key: string;
  fp: string;
  kind: AiSummaryKind;
  summary: AnySummary;
  source: Source;
  model?: string;
  note?: string;
  createdAt: string;
}

const Body = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('recording'),
    sessionId: z.string().min(1).max(100),
    refresh: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('heatmap'),
    url: z.string().url().max(2000),
    device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
    experimentId: z.string().max(100).optional(),
    variationId: z.string().max(100).optional(),
    /** Texto dos elementos lido pelo agent na página (dado não confiável: vai delimitado e mascarado). */
    context: HeatmapContextSchema.optional(),
    refresh: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('survey'),
    surveyId: z.string().min(1).max(100),
    days: z.number().int().min(1).max(365).default(90),
    refresh: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('report'),
    experimentId: z.string().min(1).max(100),
    days: z.number().int().min(1).max(365).default(30),
    device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
    /**
     * Números do relatório que a tela já mostra (sem recalcular a estatística aqui, CPU do Worker). Dado do
     * cliente: conferido contra o experimento e entre si, e usado só para explicar (D-085).
     */
    report: ReportNumbersSchema,
    refresh: z.boolean().optional(),
  }),
]);

const Out = z
  .object({
    kind: z.enum(AI_SUMMARY_KINDS),
    summary: z.record(z.string(), z.unknown()),
    source: z.enum(['claude', 'modelo', 'regras']),
    model: z.string().optional(),
    createdAt: z.string(),
    /** Veio do cache (nenhuma chamada ao modelo). */
    cached: z.boolean(),
    /** Há dado novo desde o resumo (menos de 1 h): "Atualizar" gera de novo. */
    stale: z.boolean(),
    note: z.string().optional(),
  })
  .openapi('AiSummary');
const ErrorOut = z.object({ error: z.string() });

/** Tipos com explicação sem IA (barata, sempre disponível) e o nome dela no aviso. */
const RULES: Partial<Record<AiSummaryKind, { label: string; run(input: unknown): AnySummary }>> = {
  survey: { label: 'resumo por palavras-chave', run: (i) => ruleSurvey(i as ReturnType<typeof surveyInput>) },
  report: { label: 'explicação por regras', run: (i) => ruleReport(i as ReportInput) },
};

const NO_AI =
  'IA não configurada nesta instalação: defina ANTHROPIC_API_KEY (Claude) ou AI_BASE_URL e AI_MODEL (modelo compatível com OpenAI) na API.';

/** Resumo por IA de gravação, mapa de calor e pesquisa (fase 18.4, D-084). */
export function aiSummaryRoutes(app: Api, repo: Repo, client?: Anthropic, compat?: CompatAi) {
  type In = z.infer<typeof Body>;
  /** Entrada compacta do alvo, ou o erro (404/409) se não há o que resumir. */
  async function load(
    accountId: string,
    b: In,
  ): Promise<{ key: string; input: unknown; note?: string } | { error: string; status: 404 | 409 }> {
    if (b.kind === 'recording') {
      const [rr, timeline] = await Promise.all([
        repo.getRecordingEvents(accountId, b.sessionId),
        repo.listEvents(accountId, {
          sessionId: b.sessionId,
          types: ['pageview', 'click', 'frustration', 'conversion', 'event', 'form'],
        }),
      ]);
      if (!rr && !timeline.length) return { error: 'gravação não encontrada', status: 404 };
      const ts = [
        ...timeline.map((e) => e.ts),
        ...(rr ?? []).map((e) => (e as { timestamp: number }).timestamp),
      ];
      const pv = timeline.find((e) => e.type === 'pageview');
      const input = recordingInput(timeline, rr, {
        device: pv?.type === 'pageview' ? pv.device : undefined,
        durationMs: Math.max(...ts) - Math.min(...ts),
      });
      if (!input.timeline.length)
        return {
          error: 'Sessão sem eventos para resumir (nenhuma página ou clique registrado).',
          status: 409,
        };
      return { key: `recording:${b.sessionId}`, input };
    }
    if (b.kind === 'heatmap') {
      const q = { url: b.url, device: b.device, experimentId: b.experimentId, variationId: b.variationId };
      const [base, extra] = await Promise.all([
        repo.heatmap(accountId, q, 1),
        repo.listEvents(accountId, { page: normalizePage(b.url), types: ['frustration'] }),
      ]);
      if (!base.clicks.total && !base.scroll.pageviews)
        return { error: 'Sem dados de mapa de calor nesta página ainda.', status: 409 };
      const input = heatmapInput({ ...base, ...behavior(extra, q) }, b.context, b.device);
      return {
        key: `heatmap:${base.page}|${b.device ?? ''}|${b.experimentId ?? ''}|${b.variationId ?? ''}`,
        input,
      };
    }
    if (b.kind === 'report') {
      const rec = await repo.getExperiment(accountId, b.experimentId);
      if (!rec) return { error: 'experimento não encontrado', status: 404 };
      const bad = checkReport(rec.experiment, b.report);
      if (bad)
        return {
          error: `Os números do relatório não batem com o experimento (${bad}). Recarregue o relatório.`,
          status: 409,
        };
      const r = reportInput(rec.experiment, b.report, { days: b.days, device: b.device });
      if ('error' in r) return { error: r.error, status: 409 };
      return { key: `report:${rec.experiment.id}|${b.days}|${b.device ?? ''}`, input: r.input };
    }
    const s = await repo.getEntity<Survey>(accountId, 'survey', b.surveyId);
    if (!s) return { error: 'pesquisa não encontrada', status: 404 };
    const events = await repo.listEvents(accountId, {
      from: new Date(Date.now() - b.days * 86_400_000),
      types: ['survey'],
    });
    const input = surveyInput(s.name, s.data, s.id, events);
    if (!input.total) return { error: 'Nenhuma resposta aberta no período.', status: 409 };
    const used = input.questions.reduce((n, q) => n + q.answers.length, 0);
    return {
      key: `survey:${s.id}|${b.days}`,
      input,
      note:
        used < input.total
          ? `Amostra das ${used} respostas mais recentes de ${input.total} (até ${SURVEY_SAMPLE}).`
          : undefined,
    };
  }

  async function generate(kind: AiSummaryKind, input: unknown) {
    if (client)
      return {
        summary: await claudeSummary(client, kind, input),
        source: 'claude' as const,
        model: AI_MODEL,
      };
    const r = await compatSummary(compat!, kind, input);
    return { summary: r.summary, source: 'modelo' as const, model: r.model };
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ai/summary',
      tags: ['insights'],
      security,
      summary:
        'Resumo por IA de uma gravação (objetivo, passos, onde travou, frustração), do mapa de calor de uma página (atenção, ignorado, sugestões), das respostas abertas de uma pesquisa (temas e sentimento) ou do relatório de um experimento (resultado em linguagem simples, negócio, ressalvas e próximo passo). Guardado em cache até os dados mudarem.',
      request: { body: json(Body, 'alvo do resumo') },
      responses: {
        200: json(Out, 'resumo'),
        409: json(ErrorOut, 'sem dados para resumir ou IA não configurada'),
        502: json(ErrorOut, 'provedor de IA falhou'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      const b = c.req.valid('json');
      const r = await load(user.accountId, b);
      if ('error' in r) return c.json({ error: r.error }, r.status);
      const fp = await sha256hex(`${PROMPT_VERSION}|${JSON.stringify(r.input)}`);
      const all = await repo.listEntities<Cached>(user.accountId, KIND);
      const hit = all.find((e) => e.name === r.key);
      const age = hit ? Date.now() - Date.parse(hit.data.createdAt) : Infinity;
      const reply = (x: Cached, cached: boolean, stale = false) =>
        c.json(
          {
            kind: x.kind,
            summary: x.summary as Record<string, unknown>,
            source: x.source,
            ...(x.model ? { model: x.model } : {}),
            createdAt: x.createdAt,
            cached,
            stale,
            ...(x.note ? { note: x.note } : {}),
          },
          200,
        );
      if (hit && age < TTL_MS && hit.data.fp === fp) return reply(hit.data, true);

      const now = new Date().toISOString();
      const rule = RULES[b.kind];
      const rules = (notice?: string): Cached => ({
        key: r.key,
        fp,
        kind: b.kind,
        summary: rule!.run(r.input),
        source: 'regras',
        note: [notice, r.note].filter(Boolean).join(' ') || undefined,
        createdAt: now,
      });
      // Gerar custa: quem só lê vê o que já foi gerado (mesmo com dado novo); o relatório cai nas regras.
      if (!hasRole(user, 'editor')) {
        if (hit && age < TTL_MS) return reply(hit.data, true, true);
        return b.kind === 'report'
          ? reply(rules('Explicação por regras (a explicação por IA é gerada por quem edita).'), false)
          : forbid(c);
      }
      if (hit && age < FRESH_MS && !b.refresh) return reply(hit.data, true, true);

      if (!client && !compat)
        // Pesquisa e relatório caem nas regras (baratas, sem cache: com IA configurada depois, gera de verdade).
        return rule
          ? reply(rules(`IA não configurada: ${rule.label}.`), false)
          : c.json({ error: NO_AI }, 409);
      let entry: Cached;
      try {
        entry = {
          key: r.key,
          fp,
          kind: b.kind,
          ...(await generate(b.kind, r.input)),
          createdAt: now,
          note: r.note,
        };
      } catch (e) {
        console.error('[api] resumo por IA falhou', e);
        const why = (e as Error).message.slice(0, 120);
        if (rule) return reply(rules(`A IA não respondeu agora (${why}); ${rule.label}.`), false);
        return c.json({ error: `A IA não respondeu agora (${why}). Tente de novo.` }, 502);
      }
      if (!entry.note) delete entry.note;
      await repo.saveEntity(user.accountId, {
        id: hit?.id,
        kind: KIND,
        name: r.key,
        data: entry,
        userId: user.id,
      });
      // ponytail: teto de resumos por conta apagando os mais antigos; listar tudo a cada pedido custa O(50).
      for (const old of all.filter((e) => e.id !== hit?.id).slice(MAX_CACHED - 1))
        await repo.deleteEntity(user.accountId, KIND, old.id);
      return reply(entry, false);
    },
  );
}
