import type Anthropic from '@anthropic-ai/sdk';
import { ExperimentSchema, ReportNumbersSchema, type TrackingEvent } from '@abtest/shared';
import { expect, test, vi } from 'vitest';
import {
  checkReport,
  decide,
  mergeReport,
  parseBr,
  reportInput,
  ruleReport,
  unknownNumbers,
} from './ai-report';
import { experimentReport } from './analytics/report';
import { DEMO } from './seed';
import { ev, setupApp } from './test-app';

const exp = ExperimentSchema.parse({
  id: 'exp_ai_rep',
  key: 'airep',
  name: 'Botão verde',
  status: 'running',
  hypothesis: 'Botão verde chama mais atenção e aumenta a compra',
  variations: [
    { id: 'c', key: 'controle', name: 'Controle', weight: 50 },
    { id: 'b', key: 'b', name: 'Verde', weight: 50 },
  ],
  goals: [
    { id: 'g1', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'g2', key: 'cta', type: 'click', selector: '#cta' },
  ],
});

const DAY = 86_400_000;
/** Visitantes e conversões por braço, espalhados em `days` dias até agora. */
function events(arms: { n: number; conv: number }[], days: number): TrackingEvent[] {
  const now = Date.now();
  const out: TrackingEvent[] = [];
  arms.forEach(({ n, conv }, a) => {
    const vid = exp.variations[a]!.id;
    for (let i = 0; i < n; i++) {
      const visitorId = `${vid}-${i}`;
      const ts = now - Math.floor(((i % days) + 0.5) * DAY);
      const base = {
        visitorId,
        experimentId: exp.id,
        experimentKey: exp.key,
        variationId: vid,
        variationKey: vid,
      };
      out.push(ev({ type: 'exposure', ...base, ts } as never));
      if (i < conv)
        out.push(ev({ type: 'conversion', ...base, goalId: 'g1', goalKey: 'compra', ts: ts + 1 } as never));
    }
  });
  return out;
}

/** Relatório como a tela recebe (JSON) e manda de volta. */
function numbers(arms: { n: number; conv: number }[], days: number, e = exp) {
  const rep = experimentReport(e, events(arms, days), {
    from: new Date(Date.now() - 30 * DAY),
    to: new Date(),
  });
  return ReportNumbersSchema.parse(JSON.parse(JSON.stringify(rep)));
}
const input = (rep: ReturnType<typeof numbers>, e = exp) => {
  const r = reportInput(e, rep, { days: 30 });
  if ('error' in r) throw new Error(r.error);
  return r.input;
};
const allText = (s: ReturnType<typeof ruleReport>) =>
  [
    s.summary,
    s.business,
    s.next.text,
    ...s.caveats,
    s.next.idea?.hypothesis ?? '',
    s.next.idea?.change ?? '',
  ].join('\n');

test('regras: vencedora → implementar, com ressalva de poucos dias; textos só citam números da entrada', () => {
  const i = input(
    numbers(
      [
        { n: 1000, conv: 100 },
        { n: 1000, conv: 150 },
      ],
      3,
    ),
  );
  expect(i.daysWithData).toBe(3);
  expect(i.hypothesis).toContain('Botão verde');
  expect(i.variations[1]).toMatchObject({
    name: 'Verde',
    ratePct: 15,
    verdict: 'vencedora',
    conversionsPer1000: 150,
  });
  const s = ruleReport(i);
  expect(s.next).toMatchObject({ action: 'implement', variation: 'Verde' });
  expect(s.next.idea).toBeUndefined();
  expect(s.confidence).toBe('média');
  expect(s.caveats.join(' ')).toContain('efeito novidade');
  expect(s.summary).toContain('15,00%');
  expect(s.business).toContain('150,0');
  expect(unknownNumbers(allText(s), i)).toEqual([]);
  // Mesmo resultado com 14 dias de dados: confiança alta, sem ressalvas.
  const long = ruleReport(
    input(
      numbers(
        [
          { n: 1000, conv: 100 },
          { n: 1000, conv: 150 },
        ],
        14,
      ),
    ),
  );
  expect(long).toMatchObject({ confidence: 'alta', caveats: [] });
});

test('regras: inconclusivo pequeno → continuar N dias; perdendo → parar e iterar com ideia; SRM → investigar', () => {
  const small = input(
    numbers(
      [
        { n: 60, conv: 6 },
        { n: 60, conv: 7 },
      ],
      10,
    ),
  );
  const k = ruleReport(small);
  expect(k.next.action).toBe('keep-running');
  expect(k.next.days).toBe(small.sample.daysRemaining);
  expect(k.next.days).toBeGreaterThan(0);
  expect(k.next.text).toMatch(/cerca de [\d.]+ dias/);
  expect(k.confidence).toBe('baixa');
  expect(k.caveats.join(' ')).toContain('Amostra pequena: 60 visitantes');
  expect(unknownNumbers(allText(k), small)).toEqual([]);

  const lose = input(
    numbers(
      [
        { n: 1000, conv: 150 },
        { n: 1000, conv: 90 },
      ],
      14,
    ),
  );
  const l = ruleReport(lose);
  expect(l.next.action).toBe('stop-iterate');
  expect(l.confidence).toBe('alta');
  expect(l.next.idea?.title).toBe('Nova iteração: Botão verde');
  expect(l.next.idea?.hypothesis).toContain('não se confirmou');
  expect(unknownNumbers(allText(l), lose)).toEqual([]);

  const srm = input(
    numbers(
      [
        { n: 900, conv: 90 },
        { n: 300, conv: 45 },
      ],
      14,
    ),
  );
  expect(srm.srm.problem).toBe(true);
  const s = ruleReport(srm);
  expect(s).toMatchObject({ confidence: 'baixa', next: { action: 'investigate-srm' } });
  expect(s.caveats[0]).toContain('SRM');

  // Amostra atingida sem diferença → testar ideia mais ousada.
  const { recommendation: _, ...base } = lose;
  const flat = {
    ...base,
    sample: { ...base.sample, daysRemaining: 0 },
    variations: base.variations.map((v) => ({
      ...v,
      verdict: v.control ? v.verdict : ('inconclusiva' as const),
    })),
  };
  const f = ruleReport({ ...flat, recommendation: decide(flat) });
  expect(f.next.action).toBe('test-idea');
  expect(f.next.idea).toBeDefined();
});

test('números do cliente conferidos contra o experimento e entre si', () => {
  const rep = numbers(
    [
      { n: 200, conv: 20 },
      { n: 200, conv: 30 },
    ],
    5,
  );
  expect(checkReport(exp, rep)).toBeNull();
  const tamper = (f: (r: typeof rep) => void) => {
    const r = structuredClone(rep);
    f(r);
    return checkReport(exp, r);
  };
  expect(tamper((r) => (r.goals[0]!.arms[1]!.conversions = 500))).toBe('conversões');
  expect(tamper((r) => (r.goals[0]!.arms[1]!.rate = 0.9))).toBe('taxa');
  expect(tamper((r) => (r.variations[1]!.id = 'x'))).toBe('variações diferentes');
  expect(tamper((r) => (r.visitors = 1))).toBe('total de visitantes');
  expect(tamper((r) => (r.goals[0]!.goalId = 'outra'))).toBe('metas diferentes');
  expect(tamper((r) => (r.goals[0]!.arms[1]!.verdict = 'baseline'))).toBe('veredito');
  // Sem meta, sem controle, sem visitantes: nada a explicar.
  expect(reportInput({ ...exp, goals: [] }, { ...rep, goals: [] }, { days: 30 })).toHaveProperty('error');
  expect(reportInput(exp, { ...rep, visitors: 0 }, { days: 30 })).toHaveProperty('error');
});

test('números citados pela IA: formato brasileiro, arredondamento e números inventados', () => {
  expect(parseBr('1.234,5')).toBe(1234.5);
  expect(parseBr('3,21')).toBe(3.21);
  expect(parseBr('0.05')).toBe(0.05);
  const i = { ratePct: 3.21, liftPct: 12.3, visitors: 1234, p: 0.012 };
  expect(
    unknownNumbers('Taxa de 3,21% (cerca de 3%), +12,3%, 1.234 visitantes, p 0,012, 2 variações', i),
  ).toEqual([]);
  expect(unknownNumbers('Ganho de 45% e 2.000 visitantes a mais', i)).toEqual(['45', '2.000']);
});

test('texto da IA junto às regras: ação e confiança das regras, número inventado rejeitado', () => {
  const i = input(
    numbers(
      [
        { n: 1000, conv: 100 },
        { n: 1000, conv: 150 },
      ],
      3,
    ),
  );
  const ai = {
    summary: 'Verde converte 15% contra 10% do controle.',
    business: 'Mais 50 compras a cada 1.000 visitantes.',
    caveats: ['Poucos dias de teste.'],
    nextStep: 'Publicar a Verde para todos.',
    idea: { title: 'Ignorar', hypothesis: '', change: '' },
  };
  const m = mergeReport(i, ai);
  expect(m.next).toMatchObject({
    action: 'implement',
    variation: 'Verde',
    text: 'Publicar a Verde para todos.',
  });
  expect(m.next.idea).toBeUndefined();
  expect(m.confidence).toBe('média');
  expect(m.caveats).toEqual(['Poucos dias de teste.']);
  // Menos ressalvas que as regras: ficam as das regras.
  expect(mergeReport(i, { ...ai, caveats: [] }).caveats).toEqual(i.recommendation.caveats);
  expect(() => mergeReport(i, { ...ai, summary: 'Verde ganhou 37,5% com 99,9% de certeza.' })).toThrow(
    /números que não estão no relatório \(37,5, 99,9\)/,
  );
});

const fake = (parsed_output: unknown) => {
  const parse = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
};

async function app(ai?: Anthropic) {
  const t = await setupApp(ai ? { ai } : {});
  const projectId = (await t.repo.listProjects(DEMO.accountId))[0]!.id;
  await t.repo.saveExperiment(DEMO.accountId, {
    projectId,
    editorUrl: 'http://localhost:5180/',
    experiment: exp,
  });
  const list = events(
    [
      { n: 300, conv: 30 },
      { n: 300, conv: 60 },
    ],
    10,
  );
  for (let k = 0; k < list.length; k += 150)
    expect((await t.collect(list.slice(k, k + 150))).status).toBe(204);
  const report = await t.get<Record<string, unknown>>(`/experiments/${exp.id}/report?days=30`);
  const post = (body: Record<string, unknown>, as = 'editor') =>
    t.req('/ai/summary', {
      method: 'POST',
      as,
      body: JSON.stringify({ kind: 'report', experimentId: exp.id, days: 30, report, ...body }),
    });
  return { t, report, post };
}

test('rota: sem IA explica por regras (também para quem só lê); números adulterados = 409', async () => {
  const { report, post } = await app();
  const r = (await (await post({})).json()) as {
    source: string;
    note: string;
    summary: { next: { action: string } };
  };
  expect(r).toMatchObject({
    kind: 'report',
    source: 'regras',
    cached: false,
    summary: { next: { action: 'implement' } },
  });
  expect(r.note).toContain('IA não configurada: explicação por regras');
  expect((await post({}, 'viewer')).status).toBe(200);
  const bad = structuredClone(report) as { goals: { arms: { conversions: number }[] }[] };
  bad.goals[0]!.arms[1]!.conversions = 9999;
  const tampered = await post({ report: bad });
  expect(tampered.status).toBe(409);
  expect(((await tampered.json()) as { error: string }).error).toContain('não batem');
  expect((await post({}, 'other')).status).toBe(404);
}, 30_000);

test('rota: IA falsa explica, cache por impressão digital, regras decidem a ação e número inventado cai nas regras', async () => {
  const ai = fake({
    summary: 'Verde converte 20,00% contra 10,00% do controle.',
    business: 'São 200,0 compras a cada 1.000 visitantes contra 100,0.',
    caveats: [],
    nextStep: 'Publicar a Verde.',
    idea: { title: '', hypothesis: '', change: '' },
  });
  const { post } = await app(ai.client);
  // Quem só lê não gera: sem guardado, recebe as regras.
  const viewer = (await (await post({}, 'viewer')).json()) as { source: string };
  expect(viewer.source).toBe('regras');
  expect(ai.parse).not.toHaveBeenCalled();
  const r = await (await post({})).json();
  expect(r).toMatchObject({
    source: 'claude',
    cached: false,
    summary: {
      summary: 'Verde converte 20,00% contra 10,00% do controle.',
      next: { action: 'implement', variation: 'Verde' },
    },
  });
  const prompt = ai.parse.mock.calls[0]![0].messages[0].content as string;
  expect(prompt).toMatch(/^<dados>/);
  expect(prompt).toContain('"hypothesis":"Botão verde chama mais atenção e aumenta a compra"');
  expect(prompt).toContain('"recommendation":{"action":"implement"');
  // Mesmos números: cache, sem chamar o modelo de novo (também para quem só lê).
  expect(await (await post({})).json()).toMatchObject({ cached: true, stale: false });
  expect(await (await post({}, 'viewer')).json()).toMatchObject({ cached: true, source: 'claude' });
  expect(ai.parse).toHaveBeenCalledTimes(1);
  // Modelo inventando número (outro período, sem guardado): explicação por regras com aviso.
  ai.parse.mockResolvedValue({
    stop_reason: 'end_turn',
    parsed_output: {
      summary: 'Verde trouxe 4.321 compras a mais.',
      business: '',
      caveats: [],
      nextStep: 'Publicar.',
      idea: { title: '', hypothesis: '', change: '' },
    },
  });
  const fb = (await (await post({ days: 31 })).json()) as { source: string; note: string };
  expect(fb.source).toBe('regras');
  expect(fb.note).toContain('números que não estão no relatório (4.321)');
}, 30_000);
