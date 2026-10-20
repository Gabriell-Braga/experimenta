import { z } from 'zod';
import type { Experiment, NextAction, ReportNumbers, ReportSummary } from '@abtest/shared';
import { clean } from './pii';
import { MIN_VISITORS, SEQ_ALPHA } from './analytics/report';

/**
 * Assistente de relatório (fase 18.5): explica o resultado de um experimento em linguagem simples e sugere o
 * próximo passo. A estatística é a do relatório (números que a tela já tem, conferidos aqui); a ação, a
 * confiança e as ressalvas saem das regras abaixo; o modelo só escreve os textos (D-085).
 */

const VERDICT_PT = {
  winner: 'vencedora',
  loser: 'perdendo',
  leading: 'liderando',
  inconclusive: 'inconclusiva',
  baseline: 'controle',
} as const;

/** Arredonda para `d` casas (os números da entrada já vêm no formato que o texto vai citar). */
const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number | null | undefined, d: number) =>
  n === null || n === undefined ? null : r(n * 100, d);
/** Chance em % inteiro, sem prometer 0 ou 100 (Monte Carlo). */
const chance = (p: number | null) => (p === null ? null : Math.min(99, Math.max(1, Math.round(p * 100))));

/**
 * Confere os números mandados pela tela contra o experimento (variações e metas na ordem dele) e entre si
 * (conversões ≤ visitantes, taxa = conversões/visitantes, totais, veredito do controle). Devolve o problema ou null.
 */
export function checkReport(exp: Experiment, rep: ReportNumbers): string | null {
  const vids = exp.variations.map((v) => v.id);
  if (rep.variations.map((v) => v.id).join('\n') !== vids.join('\n')) return 'variações diferentes';
  if (rep.variations.reduce((s, v) => s + v.visitors, 0) !== rep.visitors) return 'total de visitantes';
  const goals = new Map(exp.goals.map((g, i) => [g.id, i]));
  let last = -1;
  for (const g of rep.goals) {
    const i = goals.get(g.goalId);
    if (i === undefined || i <= last) return 'metas diferentes';
    last = i;
    if (g.arms.map((a) => a.variationId).join('\n') !== vids.join('\n')) return 'variações da meta';
    for (const [k, a] of g.arms.entries()) {
      if (a.visitors !== rep.variations[k]!.visitors || a.conversions > a.visitors) return 'conversões';
      if (Math.abs(a.rate - (a.visitors ? a.conversions / a.visitors : 0)) > 1e-6) return 'taxa';
      if ((k === 0) !== (a.verdict === 'baseline')) return 'veredito';
    }
  }
  if (rep.goals[0] && rep.goals[0].goalId !== exp.goals[0]?.id) return 'meta primária';
  for (const v of rep.guardrails ?? [])
    if (!vids.includes(v.variationId) || !goals.has(v.goalId)) return 'metas de guarda';
  return null;
}

/** Entrada da explicação: números já formatados como o texto vai citá-los, nomes vindos do experimento. */
export function reportInput(
  exp: Experiment,
  rep: ReportNumbers,
  q: { days: number; device?: string },
): { input: ReportInput } | { error: string } {
  const primary = rep.goals[0];
  if (!primary || exp.goals[0]?.id !== primary.goalId)
    return { error: 'Experimento sem meta: defina uma meta nas Configurações para ter o que explicar.' };
  if (exp.variations.length < 2)
    return { error: 'Lançamento sem controle (uma variação só): não há comparação para explicar.' };
  if (!rep.visitors) return { error: 'Ainda sem visitantes no período.' };
  const name = (id: string) => clean(exp.variations.find((v) => v.id === id)?.name ?? id, 80);
  const goalKey = (id: string) => clean(exp.goals.find((g) => g.id === id)?.key ?? id, 80);
  const seq = !!rep.stats?.sequential;
  const variations = primary.arms.map((a, i) => {
    const rev = primary.revenueArms?.[i];
    return {
      name: name(a.variationId),
      control: i === 0,
      visitors: a.visitors,
      conversions: a.conversions,
      ratePct: pct(a.rate, 2)!,
      rateRangePct: [pct(a.rateLow, 2)!, pct(a.rateHigh, 2)!],
      conversionsPer1000: r(a.rate * 1000, 1),
      ...(i > 0
        ? {
            liftPct: pct(a.lift, 1),
            liftRangePct: seq
              ? [pct(a.sequential?.liftLow, 0), pct(a.sequential?.liftHigh, 0)]
              : [pct(a.liftLow, 0), pct(a.liftHigh, 0)],
            chanceToBeatControlPct: chance(a.probBeatControl),
            pValue: seq
              ? a.sequential
                ? r(a.sequential.pValue, 3)
                : null
              : a.pValue === null
                ? null
                : r(a.pValue, 3),
          }
        : {}),
      chanceBestPct: chance(a.probBest),
      verdict: VERDICT_PT[a.verdict],
      ...(a.guardrailViolated ? { worsensGuardrail: true } : {}),
      ...(primary.hasRevenue
        ? {
            revenue: r(a.revenue, 2),
            revenuePerVisitor: r(a.rpv, 2),
            ...(i > 0 && rev
              ? { revenueLiftPct: pct(rev.lift, 1), revenueChancePct: chance(rev.probBeatControl) }
              : {}),
          }
        : {}),
    };
  });
  const secondaryGoals = rep.goals.slice(1, 6).map((g) => ({
    goal: goalKey(g.goalId),
    guardrail: !!g.guardrail,
    variations: g.arms.slice(1).map((a) => ({
      name: name(a.variationId),
      liftPct: pct(a.lift, 1),
      chanceToBeatControlPct: chance(a.probBeatControl),
      verdict: VERDICT_PT[a.verdict],
    })),
  }));
  const points = rep.series?.[0]?.points.length
    ? rep.series[0].points.map((_, d) => rep.series!.reduce((s, x) => s + (x.points[d]?.visitors ?? 0), 0))
    : [];
  const firstDay = points.findIndex((v) => v > 0);
  const base = {
    experiment: clean(exp.name, 120),
    ...(exp.hypothesis ? { hypothesis: clean(exp.hypothesis, 600) } : {}),
    status: { draft: 'rascunho', running: 'no ar', paused: 'pausado', archived: 'arquivado' }[exp.status],
    periodDays: q.days,
    daysWithData: firstDay < 0 ? null : points.length - firstDay,
    device: q.device ?? 'todos',
    method: seq
      ? `teste sequencial: vencedora ou perdedora com p sempre válido abaixo de ${SEQ_ALPHA}`
      : 'bayesiano: vencedora com 95% ou mais de chance de superar o controle, perdendo com 5% ou menos',
    cuped: !!rep.stats?.cuped,
    minVisitorsPerVariation: MIN_VISITORS,
    totalVisitors: rep.visitors,
    goal: goalKey(primary.goalId),
    variations,
    secondaryGoals,
    srm: { problem: rep.srm.mismatch, pValue: rep.srm.pValue === null ? null : r(rep.srm.pValue, 4) },
    guardrailViolations: (rep.guardrails ?? []).slice(0, 10).map((v) => ({
      variation: name(v.variationId),
      goal: goalKey(v.goalId),
      metric: v.metric === 'revenue' ? 'receita' : 'taxa',
      liftPct: pct(v.lift, 1),
    })),
    sample: {
      neededPerVariation: rep.estimate.neededPerVariation,
      daysRemaining: rep.estimate.daysRemaining,
      detectableLiftPct: pct(rep.estimate.mde, 0),
    },
  };
  return { input: { ...base, recommendation: decide(base) } };
}

type Base = Omit<ReportInput, 'recommendation'>;
export type ReportInput = {
  experiment: string;
  hypothesis?: string;
  status: string;
  periodDays: number;
  daysWithData: number | null;
  device: string;
  method: string;
  cuped: boolean;
  minVisitorsPerVariation: number;
  totalVisitors: number;
  goal: string;
  variations: {
    name: string;
    control: boolean;
    visitors: number;
    conversions: number;
    ratePct: number;
    rateRangePct: number[];
    conversionsPer1000: number;
    liftPct?: number | null;
    liftRangePct?: (number | null)[];
    chanceToBeatControlPct?: number | null;
    pValue?: number | null;
    chanceBestPct: number | null;
    verdict: (typeof VERDICT_PT)[keyof typeof VERDICT_PT];
    worsensGuardrail?: boolean;
    revenue?: number;
    revenuePerVisitor?: number;
    revenueLiftPct?: number | null;
    revenueChancePct?: number | null;
  }[];
  secondaryGoals: {
    goal: string;
    guardrail: boolean;
    variations: {
      name: string;
      liftPct: number | null;
      chanceToBeatControlPct: number | null;
      verdict: string;
    }[];
  }[];
  srm: { problem: boolean; pValue: number | null };
  guardrailViolations: { variation: string; goal: string; metric: string; liftPct: number | null }[];
  sample: {
    neededPerVariation: number | null;
    daysRemaining: number | null;
    detectableLiftPct: number | null;
  };
  /** Decidido pelas regras: o modelo explica, não muda. */
  recommendation: {
    action: NextAction;
    variation?: string;
    days?: number;
    confidence: ReportSummary['confidence'];
    caveats: string[];
  };
};

/** Número no formato brasileiro (1.234,5). */
const br = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined
    ? 'n/d'
    : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined ? 'n/d' : `${n > 0 ? '+' : ''}${br(n, d)}%`;

/**
 * Próximo passo, confiança e ressalvas a partir do veredito do relatório:
 * SRM → investigar; alguma vencedora → implementar a de maior melhoria; todas perdendo ou piorando meta de
 * guarda → parar e iterar; amostra necessária atingida sem decisão → testar ideia mais ousada; senão continuar.
 */
export function decide(b: Base): ReportInput['recommendation'] {
  const arms = b.variations.slice(1);
  /** Sem a série (dias desconhecidos), não penaliza. */
  const days = b.daysWithData ?? 7;
  const minVisitors = Math.min(...b.variations.map((v) => v.visitors));
  const caveats: string[] = [];
  if (b.srm.problem)
    caveats.push(
      `Divisão de tráfego fora do esperado (SRM, p = ${br(b.srm.pValue, 4)}): os visitantes não se dividiram como os pesos configurados, então os números podem estar distorcidos.`,
    );
  if (minVisitors < b.minVisitorsPerVariation)
    caveats.push(
      `Amostra pequena: ${br(minVisitors)} visitantes na menor variação (o mínimo para decidir é ${b.minVisitorsPerVariation}).`,
    );
  for (const g of b.guardrailViolations)
    caveats.push(
      `${g.variation} piora a meta de guarda ${g.goal}${g.metric === 'receita' ? ' (receita)' : ''} (${signed(g.liftPct)}).`,
    );
  for (const g of b.secondaryGoals)
    if (!g.guardrail)
      for (const v of g.variations)
        if (v.verdict === 'perdendo')
          caveats.push(`${v.name} piora a meta secundária ${g.goal} (${signed(v.liftPct)}).`);
  if (b.daysWithData !== null && days < 7)
    caveats.push(
      `Só ${br(days)} dia${days === 1 ? '' : 's'} de dados: pode ser efeito novidade e ainda não cobre uma semana inteira (dias úteis e fim de semana).`,
    );

  const winners = arms.filter((a) => a.verdict === 'vencedora');
  const shaky = days < 7 || caveats.length > 0;
  if (b.srm.problem) return { action: 'investigate-srm', confidence: 'baixa', caveats };
  if (winners.length) {
    const best = winners.sort((x, y) => (y.liftPct ?? 0) - (x.liftPct ?? 0))[0]!;
    return { action: 'implement', variation: best.name, confidence: shaky ? 'média' : 'alta', caveats };
  }
  if (arms.every((a) => a.verdict === 'perdendo' || a.worsensGuardrail))
    return {
      action: 'stop-iterate',
      confidence: arms.every((a) => a.verdict === 'perdendo') && !shaky ? 'alta' : 'média',
      caveats,
    };
  if (b.sample.daysRemaining === 0 && minVisitors >= b.minVisitorsPerVariation)
    return { action: 'test-idea', confidence: 'média', caveats };
  return {
    action: 'keep-running',
    ...(b.sample.daysRemaining ? { days: b.sample.daysRemaining } : {}),
    confidence: arms.some((a) => a.verdict === 'liderando') && !shaky ? 'média' : 'baixa',
    caveats,
  };
}

/** Variação de maior chance de superar o controle (a manchete). */
const leader = (i: ReportInput) =>
  i.variations.slice(1).sort((x, y) => (y.chanceToBeatControlPct ?? 0) - (x.chanceToBeatControlPct ?? 0))[0]!;

/** Ideia para o backlog quando o próximo passo é iterar. */
function ruleIdea(i: ReportInput): NonNullable<ReportSummary['next']['idea']> {
  const best = leader(i);
  return {
    title: `Nova iteração: ${i.experiment}`.slice(0, 200),
    hypothesis: i.hypothesis
      ? `A hipótese "${i.hypothesis.slice(0, 300)}" não se confirmou em ${i.goal} com a mudança testada; uma mudança mais forte no mesmo ponto pode mover a meta.`
      : `A mudança testada em "${i.experiment}" não moveu ${i.goal}; uma mudança mais forte no mesmo ponto pode mover a meta.`,
    change: `Variação mais ousada no mesmo ponto da página, aproveitando o que ${best.name} mostrou (${signed(best.liftPct)}).`,
  };
}

/** Explicação sem IA, só com os números da entrada (sempre disponível, sem custo). */
export function ruleReport(i: ReportInput): ReportSummary {
  const rec = i.recommendation;
  const ctrl = i.variations[0]!;
  const best = rec.variation ? i.variations.find((v) => v.name === rec.variation)! : leader(i);
  const p = i.method.startsWith('teste sequencial')
    ? `, p sempre válido ${br(best.pValue, 3)}`
    : `, ${br(best.chanceToBeatControlPct)}% de chance de superar o controle`;
  const compare = `${best.name} converte ${br(best.ratePct, 2)}% contra ${br(ctrl.ratePct, 2)}% do controle (${signed(best.liftPct)}${p})`;
  const per1000 = `A cada 1.000 visitantes, ${best.name} gera ${br(best.conversionsPer1000, 1)} conversões em ${i.goal}, contra ${br(ctrl.conversionsPer1000, 1)} do controle.`;
  const revenue =
    best.revenuePerVisitor !== undefined
      ? ` Receita por visitante: ${br(best.revenuePerVisitor, 2)} contra ${br(ctrl.revenuePerVisitor, 2)} (${signed(best.revenueLiftPct)}).`
      : '';
  const days = rec.days;
  const s: Record<NextAction, [string, string, string]> = {
    'investigate-srm': [
      `A divisão de visitantes entre as variações não bate com os pesos configurados, então o resultado em ${i.goal} ainda não é confiável.`,
      'Decidir com esses números pode levar a implementar uma mudança que não funciona ou descartar uma que funciona.',
      'Investigar a divisão de tráfego (redirecionamentos, cache, snippet fora do lugar, bots) e reiniciar o teste depois de corrigir.',
    ],
    implement: [
      `${best.name} venceu em ${i.goal}: ${compare}.`,
      per1000 + revenue,
      `Implementar ${best.name}: publicar para todo o tráfego e planejar a próxima iteração em cima dela.`,
    ],
    'stop-iterate': [
      best.worsensGuardrail && best.verdict !== 'perdendo'
        ? `${best.name} até melhora ${i.goal} (${compare}), mas piora uma meta de guarda.`
        : `Nenhuma variação superou o controle em ${i.goal}: ${compare}.`,
      'Manter o controle: a mudança não trouxe ganho e pode custar conversões.' + revenue,
      'Parar o teste, manter o controle e usar o aprendizado numa nova hipótese.',
    ],
    'test-idea': [
      `A amostra necessária foi atingida e ainda não há diferença clara em ${i.goal}: ${compare}.`,
      `Se existe diferença, ela é menor que os ${br(i.sample.detectableLiftPct)}% que o teste consegue detectar; esperar mais custa tempo e tráfego.`,
      'Encerrar o teste e testar uma variação mais ousada no mesmo ponto da página.',
    ],
    'keep-running': [
      best.verdict === 'liderando'
        ? `${best.name} está na frente em ${i.goal} (${compare}), mas ainda sem certeza.`
        : `Ainda inconclusivo em ${i.goal}: ${compare}.`,
      best.verdict === 'liderando'
        ? 'Os números apontam ganho, mas a chance de ser acaso ainda é alta demais para mudar o site.'
        : 'Ainda não dá para dizer se a mudança ganha ou perde conversões; decidir agora seria um palpite.',
      days
        ? `Continuar rodando por cerca de ${br(days)} dias${i.sample.neededPerVariation ? ` (até uns ${br(i.sample.neededPerVariation)} visitantes por variação)` : ''} antes de decidir.`
        : 'Continuar rodando até haver conversões suficientes para estimar quanto falta.',
    ],
  };
  const [summary, business, text] = s[rec.action];
  return {
    summary,
    business,
    confidence: rec.confidence,
    caveats: rec.caveats,
    next: {
      action: rec.action,
      text,
      ...(rec.variation ? { variation: rec.variation } : {}),
      ...(days ? { days } : {}),
      ...(rec.action === 'stop-iterate' || rec.action === 'test-idea' ? { idea: ruleIdea(i) } : {}),
    },
  };
}

// ---------- Modelo ----------

/** O que o modelo escreve (o resto vem das regras). */
export const ReportModelSchema = z.object({
  summary: z.string().max(400),
  business: z.string().max(400),
  caveats: z.array(z.string().max(400)),
  nextStep: z.string().max(400),
  idea: z.object({
    title: z.string().max(400),
    hypothesis: z.string().max(400),
    change: z.string().max(400),
  }),
});

export const REPORT_SYSTEM = `Você explica o resultado de um teste A/B para quem não é estatístico, a partir dos números
já calculados pelo relatório (variações, visitantes, conversões, taxa, melhoria, intervalo, chance de vencer, p,
veredito, SRM, metas de guarda e secundárias, dias com dados e amostra necessária) e da hipótese do teste, se houver.
Você NÃO calcula estatística: use só os números dados, no formato brasileiro (3,21%), e não invente números.
O próximo passo, a confiança e as ressalvas já foram decididos (campo recommendation): explique-os, não os troque.
Escreva: summary (o resultado em uma ou duas frases simples), business (o que significa para o negócio, por exemplo
conversões a cada 1.000 visitantes), caveats (uma frase por ressalva de recommendation.caveats, na mesma ordem),
nextStep (o próximo passo recomendado, concreto) e idea (só quando a ação for stop-iterate ou test-idea: uma ideia
de próximo teste com título, hipótese e mudança; senão os três vazios).`;

export const REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Resultado em linguagem simples' },
    business: { type: 'string', description: 'O que significa para o negócio' },
    caveats: { type: 'array', items: { type: 'string' }, description: 'Uma frase por ressalva dada' },
    nextStep: { type: 'string', description: 'Próximo passo recomendado (o de recommendation)' },
    idea: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        hypothesis: { type: 'string' },
        change: { type: 'string' },
      },
      required: ['title', 'hypothesis', 'change'],
      additionalProperties: false,
    },
  },
  required: ['summary', 'business', 'caveats', 'nextStep', 'idea'],
  additionalProperties: false,
};

/** Números que o texto pode citar: os da entrada (também dentro de textos, como a hipótese) e alguns fixos. */
function allowedNumbers(input: unknown): number[] {
  const out = [95, 99, 100, 1000, SEQ_ALPHA, SEQ_ALPHA * 100];
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(Math.abs(v));
    else if (typeof v === 'string') for (const m of v.matchAll(NUM)) out.push(parseBr(m[0]));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return out;
}

const NUM = /\d+(?:[.,]\d+)*/g;
/** "1.234,5" → 1234.5; "3,21" → 3.21; "0.05" → 0.05. */
export function parseBr(s: string): number {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(/\.(?=.*[.,])/g, '').replace(',', '.'));
}

/**
 * Números do texto que não estão na entrada (com tolerância de arredondamento: inteiro até 0,5; decimal até
 * 0,051). Inteiros até 10 passam ("2 variações", "7 dias").
 */
export function unknownNumbers(text: string, input: unknown): string[] {
  const allowed = allowedNumbers(input);
  const out: string[] = [];
  for (const m of text.matchAll(NUM)) {
    const v = parseBr(m[0]);
    const int = !m[0].includes(',') && (!m[0].includes('.') || /^\d{1,3}(\.\d{3})+$/.test(m[0]));
    if (int && v <= 10) continue;
    if (!allowed.some((a) => Math.abs(v - a) <= (int ? 0.5 : 0.051))) out.push(m[0]);
  }
  return out;
}

/**
 * Junta o texto do modelo às regras: ação, variação, dias e confiança são sempre os das regras; ressalvas do
 * modelo só se cobrirem todas as das regras (senão as das regras); ideia só quando a ação é iterar. Rejeita a
 * resposta que cita número fora da entrada (quem chama cai na explicação por regras).
 */
export function mergeReport(input: ReportInput, ai: z.infer<typeof ReportModelSchema>): ReportSummary {
  const texts = [
    ai.summary,
    ai.business,
    ai.nextStep,
    ...ai.caveats,
    ai.idea.title,
    ai.idea.hypothesis,
    ai.idea.change,
  ];
  const bad = [...new Set(texts.flatMap((t) => unknownNumbers(t, input)))];
  if (bad.length)
    throw new Error(`a resposta citou números que não estão no relatório (${bad.slice(0, 3).join(', ')})`);
  if (!ai.summary.trim() || !ai.nextStep.trim()) throw new Error('resposta incompleta');
  const rules = ruleReport(input);
  const caveats = ai.caveats.filter((c) => c.trim());
  const iterate = rules.next.idea !== undefined;
  return {
    summary: ai.summary,
    business: ai.business || rules.business,
    confidence: rules.confidence,
    caveats: caveats.length >= rules.caveats.length ? caveats.slice(0, 8) : rules.caveats,
    next: {
      ...rules.next,
      text: ai.nextStep,
      ...(iterate
        ? {
            idea: ai.idea.title.trim() ? { ...ai.idea, title: ai.idea.title.slice(0, 200) } : rules.next.idea,
          }
        : {}),
    },
  };
}
