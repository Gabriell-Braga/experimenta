import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
let id: string;

beforeAll(async () => {
  t = await setupApp();
  const r = await t.req('/entities/survey', {
    as: 'editor',
    method: 'POST',
    body: JSON.stringify({
      name: 'Pós-compra',
      data: {
        status: 'running',
        questions: [
          { id: 'nps', type: 'nps', text: 'Recomendaria?' },
          { id: 'csat', type: 'csat', text: 'Satisfeito?' },
          { id: 'tema', type: 'choice', text: 'Tema', options: ['Preço', 'Entrega'] },
          { id: 'txt', type: 'text', text: 'Comentário', required: false },
        ],
      },
    }),
  });
  id = ((await r.json()) as { id: string }).id;
  const resp = (visitorId: string, answers: unknown[], completed = true) =>
    ev({ type: 'survey', visitorId, surveyId: id, answers, completed } as never);
  const view = (visitorId: string) =>
    ev({ type: 'engage', visitorId, campaignId: id, kind: 'survey', action: 'view' } as never);
  await t.collect([
    view('a'),
    view('b'),
    view('c'),
    view('d'),
    resp('a', [
      { questionId: 'nps', value: 10 },
      { questionId: 'csat', value: 5 },
      { questionId: 'tema', value: 'Entrega' },
      { questionId: 'txt', value: 'Entrega rápida, adorei a entrega' },
    ]),
    resp('b', [{ questionId: 'nps', value: 3 }], false),
    resp('b', [
      { questionId: 'nps', value: 3 },
      { questionId: 'csat', value: 2 },
      { questionId: 'tema', value: 'Preço' },
    ]), // completa substitui parcial
    resp('c', [
      { questionId: 'nps', value: 8 },
      { questionId: 'csat', value: 4 },
    ]),
  ]);
});

type Q = {
  id: string;
  score?: number | null;
  average?: number | null;
  promoters?: number;
  detractors?: number;
  options?: { option: string; count: number }[];
  words?: { word: string; count: number }[];
};

test('NPS, CSAT, escolhas, palavras e taxa de resposta (uma resposta por visitante)', async () => {
  const r = await t.get<{
    views: number;
    responses: number;
    completed: number;
    responseRate: number;
    questions: Q[];
  }>(`/analytics/survey/${id}`);
  expect(r).toMatchObject({ views: 4, responses: 3, completed: 3 });
  expect(r.responseRate).toBeCloseTo(0.75, 6);
  const q = Object.fromEntries(r.questions.map((x) => [x.id, x]));
  expect(q.nps).toMatchObject({ score: 0, promoters: 1, detractors: 1 }); // (1 − 1) / 3
  expect(q.csat!.score).toBeCloseTo(2 / 3, 6);
  expect(q.tema!.options).toEqual([
    { option: 'Preço', count: 1 },
    { option: 'Entrega', count: 1 },
  ]);
  expect(q.txt!.words![0]).toEqual({ word: 'entrega', count: 2 });
  expect((await t.req(`/analytics/survey/${id}`, { as: 'other' })).status).toBe(404);
});
