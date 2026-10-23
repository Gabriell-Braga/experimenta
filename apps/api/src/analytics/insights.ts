import type { Experiment, Funnel, TrackingEvent } from '@abtest/shared';
import type { formsReport } from './forms';
import { funnelReport, LEFT_SITE } from './funnel';
import type { pagesReport } from './pages';
import { deviceByVisitor, experimentReport, MIN_VISITORS } from './report';

export type Severity = 'critical' | 'warning' | 'good' | 'info';
export interface Insight {
  /** Chave estável (mesmo achado = mesmo id entre leituras). */
  id: string;
  kind:
    'winner' | 'srm' | 'guardrail' | 'frustration' | 'form-field' | 'funnel-step' | 'low-scroll' | 'segment';
  severity: Severity;
  title: string;
  detail: string;
  /** Tela do editor que mostra o achado (`?view=` + parâmetros). */
  link: { view: string; params?: Record<string, string> };
}

/** Limiares: abaixo disso o achado é ruído. */
export const LIMITS = {
  /** Frustração: cliques rage+dead por página vista. */
  frustrationRate: 0.05,
  minPageviews: 50,
  /** Scroll médio (%) abaixo do qual a página "não é lida". */
  lowScroll: 35,
  /** Campo responsável por esta fração dos abandonos do formulário. */
  fieldDropoff: 0.3,
  minAbandons: 10,
  /** Passo de funil que perde mais que isto dos que chegaram no anterior. */
  funnelLoss: 0.5,
  minFunnelVisitors: 30,
  /** Segmento divergente: P(> controle) num dispositivo ≥ alto e noutro ≤ 1 − alto. */
  divergent: 0.9,
};

const DEVICE: Record<string, string> = { desktop: 'desktop', tablet: 'tablet', mobile: 'celular' };
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
const pct = (n: number) => `${Math.round(n * 100)}%`;
// Vencedor logo depois do crítico: é a decisão mais valiosa a tomar.
const RANK: Record<Severity, number> = { critical: 0, good: 1, warning: 2, info: 3 };

/** Experimentos: vencedor declarado, SRM e variação que ganha num dispositivo e perde noutro. */
function experimentInsights(
  exp: Experiment,
  events: TrackingEvent[],
  devices: Map<string, string>,
  range: { from: Date; to: Date },
  r = experimentReport(exp, events, range),
) {
  const out: Insight[] = [];
  const link = { view: 'report', params: { id: exp.id } };
  if (r.srm.mismatch)
    out.push({
      id: `srm:${exp.id}`,
      kind: 'srm',
      severity: 'critical',
      title: `${exp.name}: divisão de tráfego desbalanceada (SRM)`,
      detail: `As variações receberam ${r.variations.map((v) => v.visitors).join(' / ')} visitantes, longe dos pesos configurados (p = ${r.srm.pValue.toFixed(4)}). Os resultados não são confiáveis até achar a causa (redirecionamento, cache, bot).`,
      link,
    });
  const goal = r.goals.find((g) => g.primary) ?? r.goals[0];
  if (!goal) return out;
  const name = (id: string) => exp.variations.find((v) => v.id === id)?.name ?? id;
  for (const g of r.guardrails)
    out.push({
      id: `guardrail:${exp.id}:${g.variationId}:${g.goalId}`,
      kind: 'guardrail',
      severity: 'critical',
      title: `${exp.name}: ${name(g.variationId)} piora a meta de guarda ${g.goalKey}`,
      detail: `${g.metric === 'revenue' ? 'Receita por visitante' : 'Conversão'} em ${g.goalKey}: ${g.lift !== null && g.lift >= 0 ? '+' : ''}${pct(g.lift ?? 0)} vs controle, com confiança. Ela não é declarada vencedora enquanto isso; avalie pausar a variação.`,
      link: { view: 'report', params: { id: exp.id, goal: g.goalId } },
    });
  const win = goal.arms.find((a) => a.verdict === 'winner');
  if (win)
    out.push({
      id: `winner:${exp.id}:${win.variationId}`,
      kind: 'winner',
      severity: 'good',
      title: `${exp.name}: ${name(win.variationId)} venceu`,
      detail: `${win.lift !== null && win.lift >= 0 ? '+' : ''}${pct(win.lift ?? 0)} em ${goal.goalKey}, ${pct(win.probBeatControl ?? 0)} de chance de ser melhor que o controle. Hora de implementar e encerrar o teste.`,
      link,
    });
  // Por dispositivo: só com amostra mínima em todas as variações. Só a meta primária e sem metas de guarda
  // (cada meta custa um Monte Carlo; o painel roda no limite de CPU do Worker grátis).
  const primary = {
    ...exp,
    goals: exp.goals.filter((x) => x.id === goal.goalId),
    stats: { ...exp.stats, guardrails: [] },
  };
  const per = Object.keys(DEVICE).flatMap((d) => {
    const g = experimentReport(
      primary,
      events,
      range,
      (v) => devices.get(v) === d,
      undefined,
      2000,
    ).goals.find((x) => x.goalId === goal.goalId);
    return g && g.arms.every((a) => a.visitors >= MIN_VISITORS) ? [{ device: d, arms: g.arms }] : [];
  });
  for (const arm of goal.arms.slice(1)) {
    const ps = per.map((p) => ({
      device: p.device,
      p: p.arms.find((a) => a.variationId === arm.variationId)?.probBeatControl ?? 0.5,
    }));
    const hi = ps.find((x) => x.p >= LIMITS.divergent);
    const lo = ps.find((x) => x.p <= 1 - LIMITS.divergent);
    if (hi && lo)
      out.push({
        id: `segment:${exp.id}:${arm.variationId}`,
        kind: 'segment',
        severity: 'info',
        title: `${exp.name}: ${name(arm.variationId)} ganha no ${DEVICE[hi.device]} e perde no ${DEVICE[lo.device]}`,
        detail: `Chance de ser melhor que o controle: ${pct(hi.p)} no ${DEVICE[hi.device]}, ${pct(lo.p)} no ${DEVICE[lo.device]}. Considere personalizar por dispositivo em vez de escolher uma só.`,
        link: { view: 'report', params: { id: exp.id, device: lo.device } },
      });
  }
  return out;
}

/**
 * Achados automáticos do período, do mais grave ao informativo: vencedor, SRM, frustração, campo que faz
 * abandonar formulário, passo de funil com grande perda, página pouco lida e segmento divergente.
 */
export function findInsights(input: {
  cur: TrackingEvent[];
  range: { from: Date; to: Date };
  running: Experiment[];
  funnels: { id: string; name: string; data: Funnel }[];
  pages: ReturnType<typeof pagesReport>;
  forms: ReturnType<typeof formsReport>;
  /** Relatórios já calculados por experimento (o painel reaproveita no resumo dos testes). */
  reports?: Map<string, ReturnType<typeof experimentReport>>;
}): Insight[] {
  const { cur, range, running, funnels, pages, forms, reports } = input;
  const out: Insight[] = [];
  const devices = deviceByVisitor(cur.filter((e) => e.type === 'pageview'));
  for (const exp of running)
    out.push(
      ...experimentInsights(
        exp,
        cur.filter((e) => 'experimentId' in e && e.experimentId === exp.id),
        devices,
        range,
        reports?.get(exp.id),
      ),
    );

  for (const p of pages) {
    if (p.pageviews < LIMITS.minPageviews) continue;
    const rate = (p.rage + p.dead) / p.pageviews;
    if (rate >= LIMITS.frustrationRate)
      out.push({
        id: `frustration:${p.page}`,
        kind: 'frustration',
        severity: 'warning',
        title: `Frustração em ${path(p.page)}`,
        detail: `${p.rage} rage clicks e ${p.dead} dead clicks em ${p.pageviews} visitas (${pct(rate)}). Veja no mapa de calor onde os visitantes clicam sem resposta.`,
        link: { view: 'heatmap', params: { url: p.href } },
      });
    if (p.avgScroll !== null && p.avgScroll < LIMITS.lowScroll)
      out.push({
        id: `scroll:${p.page}`,
        kind: 'low-scroll',
        severity: 'info',
        title: `${path(p.page)} é pouco lida`,
        detail: `Em média os visitantes rolam só ${p.avgScroll}% da página. O que está abaixo disso (CTA, prova social) quase não é visto.`,
        link: { view: 'heatmap', params: { url: p.href } },
      });
  }

  for (const f of forms) {
    const abandons = f.interacted - f.submitted;
    if (abandons < LIMITS.minAbandons) continue;
    const worst = [...f.fields].sort((a, b) => b.dropoffRate - a.dropoffRate)[0];
    if (worst && worst.dropoffRate >= LIMITS.fieldDropoff)
      out.push({
        id: `form:${f.page}|${f.form}|${worst.name}`,
        kind: 'form-field',
        severity: 'warning',
        title: `Campo "${worst.name}" faz desistir do formulário`,
        detail: `${pct(worst.dropoffRate)} dos ${abandons} abandonos de ${f.form} em ${path(f.page)} param nesse campo. Simplifique, torne opcional ou explique por que é pedido.`,
        link: { view: 'forms' },
      });
  }

  for (const fu of funnels) {
    const r = funnelReport(fu.data, cur);
    if (r.visitors < LIMITS.minFunnelVisitors) continue;
    const steps = r.steps.slice(1);
    const worst = steps.reduce<(typeof steps)[number] | null>(
      (w, s) => (!w || s.fromPrevious < w.fromPrevious ? s : w),
      null,
    );
    const i = worst ? r.steps.indexOf(worst) : -1;
    const next = r.steps[i - 1]?.dropoffNext[0]?.page;
    const where = !next
      ? ''
      : next === LEFT_SITE
        ? 'A maioria sai do site.'
        : `A maioria vai para ${path(next)}.`;
    if (worst && 1 - worst.fromPrevious >= LIMITS.funnelLoss)
      out.push({
        id: `funnel:${fu.id}:${i}`,
        kind: 'funnel-step',
        severity: 'warning',
        title: `${fu.name}: ${pct(1 - worst.fromPrevious)} param antes de "${worst.name}"`,
        detail:
          `De ${r.steps[i - 1]!.visitors} visitantes em "${r.steps[i - 1]!.name}", só ${worst.visitors} chegam a "${worst.name}". ${where}`.trim(),
        link: { view: 'funnels', params: { id: fu.id } },
      });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
