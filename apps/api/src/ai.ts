import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { z } from '@hono/zod-openapi';
import type { Dashboard } from './analytics/dashboard';
import type { Insight } from './analytics/insights';

export const AI_MODEL = 'claude-opus-5-5';

const IdeaSchema = z.object({
  title: z.string(),
  hypothesis: z.string(),
  page: z.string(),
  change: z.string(),
  metric: z.string(),
  impact: z.enum(['alto', 'médio', 'baixo']),
  effort: z.enum(['alto', 'médio', 'baixo']),
  basedOn: z.string(),
});
export type Idea = z.infer<typeof IdeaSchema>;

const IDEAS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nome curto do teste' },
          hypothesis: { type: 'string', description: 'Se mudarmos X, então Y, porque Z' },
          page: { type: 'string', description: 'Caminho da página ou "todo o site"' },
          change: { type: 'string', description: 'O que muda na variação, concreto' },
          metric: { type: 'string', description: 'Meta primária a medir' },
          impact: { type: 'string', enum: ['alto', 'médio', 'baixo'] },
          effort: { type: 'string', enum: ['alto', 'médio', 'baixo'] },
          basedOn: { type: 'string', description: 'Qual dado do painel motivou a ideia' },
        },
        required: ['title', 'hypothesis', 'page', 'change', 'metric', 'impact', 'effort', 'basedOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
} as const;

const SYSTEM = `Você é especialista em otimização de conversão (CRO) e testes A/B.
Recebe o painel de uma conta (métricas agregadas e achados automáticos do período) e propõe até 6 ideias de teste,
em português do Brasil, priorizadas por impacto esperado / esforço. Cada ideia nasce de um dado do painel (cite qual
em "basedOn"), tem hipótese falsificável e uma mudança concreta que um editor visual consegue fazer (texto, layout,
ordem, visibilidade, CTA, campos de formulário, pop-up). Não invente números que não estão no painel. Se um teste em
execução já tem vencedora, a primeira ideia é implementá-la e testar o próximo passo. Não use travessão nem meia-risca
no texto; use vírgula, dois-pontos ou ponto.`;

/** Tira travessão/meia-risca que o modelo usar mesmo assim (o app não usa esses traços). */
const noDash = (ideas: Idea[]): Idea[] =>
  ideas.map(
    (i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.replace(/\s*[—–]\s*/g, ', ')])) as Idea,
  );

/** Ideias sem IA: uma por achado automático (usado sem chave da API ou se a chamada falhar). */
export function ruleIdeas(insights: Insight[]): Idea[] {
  const out: Idea[] = [];
  for (const i of insights) {
    const page = i.link.params?.url?.replace(/^https?:\/\/[^/]+/, '') || 'todo o site';
    const base = { page, basedOn: i.title };
    if (i.kind === 'winner')
      out.push({
        ...base,
        title: 'Implementar a vencedora',
        hypothesis: `${i.detail}`,
        change: 'Publicar a variação vencedora para 100% e testar a próxima iteração dela.',
        metric: 'mesma meta do teste',
        impact: 'alto',
        effort: 'baixo',
      });
    else if (i.kind === 'frustration')
      out.push({
        ...base,
        title: 'Tornar clicável o que parece clicável',
        hypothesis:
          'Se os elementos que recebem rage/dead clicks virarem links ou botões reais, a frustração cai e mais visitantes avançam.',
        change:
          'Transformar o elemento mais clicado sem resposta em link para o destino esperado, ou tirar a aparência de botão.',
        metric: 'cliques no CTA principal',
        impact: 'médio',
        effort: 'baixo',
      });
    else if (i.kind === 'low-scroll')
      out.push({
        ...base,
        title: 'Subir o CTA e a prova social',
        hypothesis:
          'Se o CTA e a prova social aparecerem na primeira dobra, mais visitantes os veem e convertem.',
        change: 'Mover o CTA principal e um depoimento para logo abaixo do título.',
        metric: 'conversão da página',
        impact: 'médio',
        effort: 'baixo',
      });
    else if (i.kind === 'form-field')
      out.push({
        ...base,
        page: 'formulário',
        title: 'Simplificar o campo que faz desistir',
        hypothesis: `Se o campo deixar de ser obrigatório (ou for explicado), menos visitantes abandonam. ${i.title}.`,
        change: 'Tornar o campo opcional ou mover para depois do envio, com texto de ajuda.',
        metric: 'envio do formulário',
        impact: 'alto',
        effort: 'baixo',
      });
    else if (i.kind === 'funnel-step')
      out.push({
        ...base,
        page: 'passo do funil',
        title: 'Reduzir atrito no passo com mais perda',
        hypothesis:
          'Se o passo seguinte ficar mais claro e com menos distração, mais visitantes chegam a ele.',
        change:
          'Destacar o botão de avançar, remover links de saída e reforçar garantia/frete no passo anterior.',
        metric: 'conclusão do funil',
        impact: 'alto',
        effort: 'médio',
      });
    else if (i.kind === 'segment')
      out.push({
        ...base,
        title: 'Personalizar por dispositivo',
        hypothesis:
          'A variação funciona num dispositivo e piora noutro; servir cada versão a quem ela ajuda soma os dois ganhos.',
        change: 'Criar uma personalização com a variação só para o dispositivo onde ela ganha.',
        metric: 'mesma meta do teste',
        impact: 'médio',
        effort: 'baixo',
      });
  }
  return out.slice(0, 6);
}

/** Painel reduzido ao que importa para gerar ideias (só agregados, nenhum dado de visitante). */
export function ideaContext(d: Dashboard) {
  return {
    period: { from: d.from, to: d.to },
    traffic: { ...d.traffic, series: undefined },
    experiments: d.experiments,
    behavior: d.behavior,
    forms: d.forms,
    engage: d.engage,
    insights: d.insights.map(({ title, detail, severity, kind }) => ({ kind, severity, title, detail })),
  };
}

/** Ideias de teste com Claude a partir do painel (saída estruturada e validada). */
export async function claudeIdeas(client: Anthropic, d: Dashboard): Promise<Idea[]> {
  const res = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(IDEAS_JSON_SCHEMA) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Painel da conta:\n${JSON.stringify(ideaContext(d))}` }],
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens')
    throw new Error(`sem ideias (${res.stop_reason})`);
  const parsed = z.object({ ideas: z.array(IdeaSchema) }).safeParse(res.parsed_output);
  if (!parsed.success) throw new Error('resposta fora do formato');
  return noDash(parsed.data.ideas.slice(0, 6));
}

/**
 * Modelo gratuito por API compatível com OpenAI (`/chat/completions`): Gemini (camada grátis), Groq, OpenRouter
 * (modelos `:free`) ou Ollama local. Liga com AI_BASE_URL + AI_MODEL (+ AI_API_KEY quando o provedor pede).
 * AI_MODEL aceita uma lista separada por vírgula: modelo grátis sobrecarregado (429/5xx) passa para o próximo.
 */
export interface CompatAi {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export function compatFromEnv(env: Record<string, string | undefined>): CompatAi | undefined {
  if (!env.AI_BASE_URL || !env.AI_MODEL) return undefined;
  return { baseUrl: env.AI_BASE_URL.replace(/\/+$/, ''), model: env.AI_MODEL, apiKey: env.AI_API_KEY };
}

export async function compatIdeas(
  cfg: CompatAi,
  d: Dashboard,
  f: typeof fetch = fetch,
): Promise<{ model: string; ideas: Idea[] }> {
  const models = cfg.model
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  for (const [i, model] of models.entries()) {
    try {
      return { model, ideas: await askModel(cfg, model, d, f) };
    } catch (e) {
      const busy = e instanceof Busy || (e as Error).name === 'TimeoutError';
      if (!busy || i === models.length - 1) throw e;
    }
  }
  throw new Error('nenhum modelo configurado');
}

class Busy extends Error {}

async function askModel(cfg: CompatAi, model: string, d: Dashboard, f: typeof fetch): Promise<Idea[]> {
  const res = await f(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    // Modelo grátis sob carga às vezes não responde: passa para o próximo da lista (ou as regras).
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model,
      temperature: 0.4,
      // json_object é o modo JSON que todos esses provedores aceitam; o formato vai no prompt e o zod valida.
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${SYSTEM}\nResponda só com um objeto JSON neste JSON Schema (sem texto fora dele):\n${JSON.stringify(IDEAS_JSON_SCHEMA)}`,
        },
        { role: 'user', content: `Painel da conta:\n${JSON.stringify(ideaContext(d))}` },
      ],
    }),
  });
  if (!res.ok) {
    const msg = `${model} respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`;
    throw res.status === 429 || res.status >= 500 ? new Busy(msg) : new Error(msg);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = (body.choices?.[0]?.message?.content ?? '').replace(/^\s*```(?:json)?|```\s*$/g, '');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('resposta não é JSON');
  }
  const parsed = z.object({ ideas: z.array(IdeaSchema).min(1) }).safeParse(json);
  if (!parsed.success) throw new Error('resposta fora do formato');
  return noDash(parsed.data.ideas.slice(0, 6));
}
