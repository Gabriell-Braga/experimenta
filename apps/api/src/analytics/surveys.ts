import type { Survey, TrackingEvent } from '@abtest/shared';

/** Palavras sem conteúdo (pt) ignoradas na contagem das respostas abertas. */
export const STOP = new Set(
  'a o e é de do da dos das em no na nos nas um uma uns umas que se por para com sem mais mas muito muita pouco ou eu me meu minha não nao sim foi ser ter tem está esta isso isto já ja como quando porque pra pro ao à as os the and to'.split(
    ' ',
  ),
);

/**
 * Relatório de pesquisa: exibições, respostas (visitantes únicos), conclusão e, por pergunta, a métrica do
 * tipo — NPS (promotores − detratores), CSAT (% 4–5), CES e nota (média), distribuição, escolhas e textos.
 */
export function surveyReport(survey: Survey, surveyId: string, events: TrackingEvent[]) {
  const views = events.filter(
    (e) => e.type === 'engage' && e.campaignId === surveyId && e.action === 'view' && !e.qa,
  ).length;
  // Última resposta de cada visitante (respostas parciais seguidas de completas não contam duas vezes).
  const latest = new Map<string, Extract<TrackingEvent, { type: 'survey' }>>();
  for (const e of events)
    if (e.type === 'survey' && e.surveyId === surveyId && !e.qa) latest.set(e.visitorId, e);
  const responses = [...latest.values()];
  const questions = survey.questions.map((q) => {
    const values = responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === q.id).map((a) => a.value),
    );
    const nums = values.filter((v): v is number => typeof v === 'number');
    const dist = new Map<string, number>();
    for (const v of values.flatMap((v) => (Array.isArray(v) ? v : [v])))
      if (q.type !== 'text') dist.set(String(v), (dist.get(String(v)) ?? 0) + 1);
    const base = { id: q.id, type: q.type, text: q.text, answers: values.length };
    if (q.type === 'nps') {
      const pro = nums.filter((n) => n >= 9).length;
      const det = nums.filter((n) => n <= 6).length;
      return {
        ...base,
        score: nums.length ? Math.round(((pro - det) / nums.length) * 100) : null,
        promoters: pro,
        passives: nums.length - pro - det,
        detractors: det,
        distribution: Object.fromEntries(dist),
      };
    }
    if (q.type === 'csat')
      return {
        ...base,
        score: nums.length ? nums.filter((n) => n >= 4).length / nums.length : null,
        average: avg(nums),
        distribution: Object.fromEntries(dist),
      };
    if (q.type === 'ces' || q.type === 'rating')
      return { ...base, average: avg(nums), distribution: Object.fromEntries(dist) };
    if (q.type === 'text') {
      const words = new Map<string, number>();
      for (const t of values as string[])
        for (const w of String(t)
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .split(/[^a-z0-9]+/))
          if (w.length > 2 && !STOP.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
      return {
        ...base,
        recent: (values as string[]).slice(-20).reverse(),
        words: [...words.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([word, count]) => ({ word, count })),
      };
    }
    return { ...base, options: q.options.map((o) => ({ option: o, count: dist.get(o) ?? 0 })) };
  });
  return {
    views,
    responses: responses.length,
    completed: responses.filter((r) => r.completed).length,
    responseRate: views ? responses.length / views : 0,
    questions,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
