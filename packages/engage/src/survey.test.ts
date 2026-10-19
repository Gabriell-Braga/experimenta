// @vitest-environment jsdom
import { SurveySchema } from '@abtest/shared';
import { expect, test } from 'vitest';
import { nextIndex, renderSurvey, type Answer } from './survey';

const survey = SurveySchema.parse({
  questions: [
    { id: 'nps', type: 'nps', text: 'Recomendaria?', logic: [{ op: 'gte', value: 9, goto: 'end' }] },
    { id: 'pq', type: 'text', text: 'O que faltou?', required: false },
    { id: 'tema', type: 'choice', text: 'Tema?', options: ['Preço', 'Entrega'] },
  ],
});

test('lógica: promotor (9+) encerra; detrator segue; sem regra = próxima', () => {
  expect(nextIndex(survey, 0, 10)).toBe(3);
  expect(nextIndex(survey, 0, 3)).toBe(1);
  expect(nextIndex(survey, 1, 'x')).toBe(2);
});

function run() {
  let done: { answers: Answer[]; completed: boolean } | null = null;
  const w = renderSurvey(document, survey, {
    onDone: (answers, completed) => (done = { answers, completed }),
  });
  document.body.append(w.host);
  const root = w.host.shadowRoot!;
  const btn = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;
  return { root, btn, done: () => done, host: w.host };
}

test('fluxo de detrator: nota → texto → escolha → enviar (respostas e concluída)', () => {
  const s = run();
  expect((s.btn('Próxima') as HTMLButtonElement).disabled).toBe(true); // obrigatória
  s.btn('4').click();
  s.btn('Próxima').click();
  const ta = s.root.querySelector('textarea')!;
  ta.value = 'Frete caro';
  ta.dispatchEvent(new Event('input'));
  s.btn('Próxima').click();
  const opt = s.root.querySelector('input[value=Entrega]') as HTMLInputElement;
  opt.checked = true;
  opt.dispatchEvent(new Event('change'));
  s.btn('Enviar').click();
  expect(s.done()).toEqual({
    completed: true,
    answers: [
      { questionId: 'nps', value: 4 },
      { questionId: 'pq', value: 'Frete caro' },
      { questionId: 'tema', value: 'Entrega' },
    ],
  });
  expect(s.root.textContent).toContain('Obrigado');
  s.host.remove();
});

test('fechar no meio envia parciais (não concluída)', () => {
  const s = run();
  s.btn('10').click();
  s.btn('Próxima').click(); // promotor: encerra
  expect(s.done()).toEqual({ completed: true, answers: [{ questionId: 'nps', value: 10 }] });
  s.host.remove();
  const t = run();
  t.btn('2').click();
  t.btn('Próxima').click();
  t.btn('×').click();
  expect(t.done()).toEqual({ completed: false, answers: [{ questionId: 'nps', value: 2 }] });
});
