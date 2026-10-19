// @vitest-environment jsdom
import { TrackingEventSchema, type TrackingEvent } from '@abtest/shared';
import { beforeEach, expect, test } from 'vitest';
import { startForms } from './forms';

let sent: TrackingEvent[];
let clock: number;
let flushed: number;
const boot = () => ({
  apiUrl: '',
  accountId: 'acc',
  visitorId: 'v1',
  sessionId: 's1',
  device: 'desktop' as const,
  record: false,
  forms: true,
  send: (e: TrackingEvent) => sent.push(e),
  flush: () => flushed++,
  base: () => ({
    eventId: `e${sent.length}`,
    ts: 1,
    accountId: 'acc',
    visitorId: 'v1',
    sessionId: 's1',
    url: 'http://x/contato',
  }),
  variations: () => ({ exp: 'b' }),
  onNavigate: [] as ((u: string) => void)[],
});

beforeEach(() => {
  sent = [];
  clock = 0;
  flushed = 0;
  document.body.innerHTML = `
    <form id="contato">
      <input name="nome"><input name="email" type="email"><textarea name="msg"></textarea>
      <input type="checkbox" name="aceito"><input type="hidden" name="t" value="x"><button>Enviar</button>
    </form>
    <form name="busca"><input name="q"></form>`;
});

const at = (ms: number) => (clock = ms);
const focus = (el: Element) => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
const blur = (el: Element) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

test('tempo, hesitação, re-preenchimento e envio por campo; valores nunca saem', () => {
  const b = boot();
  startForms(window, b, () => clock);
  const nome = document.querySelector<HTMLInputElement>('[name=nome]')!;
  const email = document.querySelector<HTMLInputElement>('[name=email]')!;
  at(1000);
  focus(nome);
  at(1600);
  type(nome, 'Ana'); // hesitação 600 ms
  at(3000);
  blur(nome); // 2 s no campo (+1 s depois = 3 s)
  at(4000);
  focus(nome);
  at(4200);
  type(nome, 'Ana Lima'); // re-preenchimento
  at(5000);
  blur(nome);
  focus(email);
  at(6000);
  document.querySelector('#contato')!.dispatchEvent(new Event('submit', { bubbles: true }));
  const [f] = sent as Extract<TrackingEvent, { type: 'form' }>[];
  expect(f).toMatchObject({
    type: 'form',
    form: '#contato',
    interacted: true,
    submitted: true,
    variations: { exp: 'b' },
  });
  expect(f!.lastField).toBeUndefined();
  expect(f!.fields.map((x) => x.name)).toEqual(['nome', 'email', 'msg', 'aceito']); // hidden e botão fora
  expect(f!.fields[0]).toEqual({
    name: 'nome',
    kind: 'text',
    time: 3000,
    hesitation: 600,
    focus: 2,
    refills: 1,
    filled: true,
  });
  expect(f!.fields[1]).toMatchObject({ name: 'email', focus: 1, time: 1000, filled: false });
  expect(JSON.stringify(sent)).not.toContain('Ana');
  expect(TrackingEventSchema.safeParse(f).success).toBe(true);
});

test('ao sair sem enviar: formulários vistos vão com interação e último campo (abandono)', () => {
  const b = boot();
  startForms(window, b, () => clock);
  focus(document.querySelector('[name=msg]')!);
  window.dispatchEvent(new Event('pagehide'));
  const byForm = Object.fromEntries(
    (sent as Extract<TrackingEvent, { type: 'form' }>[]).map((e) => [e.form, e]),
  );
  expect(byForm['#contato']).toMatchObject({ interacted: true, submitted: false, lastField: 'msg' });
  expect(byForm['form[name="busca"]']).toMatchObject({ interacted: false, submitted: false });
  expect(flushed).toBeGreaterThan(0);
});
