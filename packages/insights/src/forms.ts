import { pathOf } from '@abtest/selector/resolve';
import type { TrackingEvent } from '@abtest/shared';
import type { InsightsBoot } from '@abtest/snippet/insights';

type FormEvent = Extract<TrackingEvent, { type: 'form' }>;
type Field = FormEvent['fields'][number];

interface FieldState extends Field {
  /** Foco atual começou em (ms). */
  since?: number;
  /** Saiu do campo preenchido: a próxima digitação conta como re-preenchimento. */
  leftFilled?: boolean;
  counted?: boolean;
}
interface FormState {
  key: string;
  fields: Map<Element, FieldState>;
  interacted: boolean;
  submitted: boolean;
  lastField?: string;
  sent: boolean;
}

const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const isField = (el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  (el instanceof HTMLInputElement && !SKIP.has(el.type)) ||
  el instanceof HTMLSelectElement ||
  el instanceof HTMLTextAreaElement;

const nameOf = (el: Element) => (el.getAttribute('name') || el.id || pathOf(el)).slice(0, 200);
const keyOf = (f: HTMLFormElement) =>
  (f.id ? `#${f.id}` : f.getAttribute('name') ? `form[name="${f.getAttribute('name')}"]` : pathOf(f)).slice(
    0,
    300,
  );
const filledOf = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) =>
  el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.checked : !!el.value;

/**
 * Form analytics: mede cada campo de cada formulário da página (tempo, hesitação, focos, re-preenchimento,
 * preenchido) e envia um evento `form` por formulário no envio ou ao sair/navegar. Nunca lê o valor para
 * envio — só se está vazio ou não.
 */
export function startForms(win: Window, boot: InsightsBoot, now = () => Date.now()) {
  const doc = win.document;
  const forms = new Map<HTMLFormElement, FormState>();

  const stateOf = (form: HTMLFormElement): FormState => {
    let s = forms.get(form);
    if (!s) {
      s = { key: keyOf(form), fields: new Map(), interacted: false, submitted: false, sent: false };
      for (const el of Array.from(form.elements))
        if (isField(el))
          s.fields.set(el, {
            name: nameOf(el),
            kind: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
            time: 0,
            focus: 0,
            refills: 0,
            filled: filledOf(el),
          });
      forms.set(form, s);
    }
    return s;
  };
  const scan = () => Array.from(doc.forms).forEach(stateOf);
  const field = (t: EventTarget | null) => {
    if (!(t instanceof Element) || !isField(t) || !t.form) return null;
    const s = stateOf(t.form);
    let f = s.fields.get(t);
    if (!f)
      s.fields.set(
        t,
        (f = {
          name: nameOf(t),
          kind: t.tagName.toLowerCase(),
          time: 0,
          focus: 0,
          refills: 0,
          filled: false,
        }),
      );
    return { s, f, el: t };
  };

  doc.addEventListener(
    'focusin',
    (e) => {
      const x = field(e.target);
      if (!x) return;
      x.s.interacted = true;
      x.s.lastField = x.f.name;
      x.f.focus++;
      x.f.since = now();
    },
    true,
  );
  const onInput = (e: Event) => {
    const x = field(e.target);
    if (!x) return;
    if (x.f.hesitation === undefined && x.f.since !== undefined) x.f.hesitation = now() - x.f.since;
    if (x.f.leftFilled && !x.f.counted) {
      x.f.refills++;
      x.f.counted = true;
    }
  };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  doc.addEventListener(
    'focusout',
    (e) => {
      const x = field(e.target);
      if (!x) return;
      if (x.f.since !== undefined) x.f.time += now() - x.f.since;
      x.f.since = undefined;
      x.f.filled = filledOf(x.el);
      x.f.leftFilled = x.f.filled;
      x.f.counted = false;
    },
    true,
  );

  const send = (s: FormState) => {
    if (s.sent) return;
    s.sent = true;
    const fields = [...s.fields.values()]
      .slice(0, 60)
      .map(({ name, kind, time, hesitation, focus, refills, filled, since }) => ({
        name,
        kind,
        // Campo ainda com foco ao sair: conta o tempo até agora.
        time: Math.round(time + (since !== undefined ? now() - since : 0)),
        ...(hesitation !== undefined ? { hesitation: Math.round(hesitation) } : {}),
        focus,
        refills,
        filled,
      }));
    boot.send({
      ...boot.base(),
      type: 'form',
      device: boot.device,
      variations: boot.variations(),
      form: s.key,
      fields,
      interacted: s.interacted,
      submitted: s.submitted,
      ...(!s.submitted && s.lastField ? { lastField: s.lastField } : {}),
    } as FormEvent);
  };

  doc.addEventListener(
    'submit',
    (e) => {
      if (!(e.target instanceof HTMLFormElement)) return;
      const s = stateOf(e.target);
      s.submitted = true;
      send(s);
    },
    true,
  );
  /** Fim da página vista: envia os formulários ainda não enviados (chegaram/interagiram sem enviar). */
  const end = () => {
    scan();
    forms.forEach(send);
    forms.clear();
    boot.flush();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
  win.addEventListener('pagehide', end);
  boot.onNavigate.push(end);
  return { end };
}
