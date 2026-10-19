import type { TrackingEvent } from '@abtest/shared';
import { normalizePage } from '../repo';
import { matchesBehavior, type BehaviorFilter } from './behavior';

type FormEvent = Extract<TrackingEvent, { type: 'form' }>;

interface FieldAgg {
  name: string;
  kind: string;
  focused: number;
  time: number;
  hesitation: number;
  hesitations: number;
  refilled: number;
  ignored: number;
  dropoffs: number;
  filled: number;
}

/**
 * Form analytics por formulário (página + seletor): chegaram (páginas vistas com o formulário), interagiram,
 * enviaram e, por campo, tempo médio, hesitação, taxa de re-preenchimento, de campo ignorado e de abandono
 * (último campo com foco de quem saiu sem enviar).
 */
export function formsReport(events: TrackingEvent[], f: BehaviorFilter = {}) {
  const forms = new Map<
    string,
    {
      page: string;
      form: string;
      landed: number;
      interacted: number;
      submitted: number;
      fields: Map<string, FieldAgg>;
    }
  >();
  for (const e of events) {
    if (e.type !== 'form' || e.qa || !matchesBehavior(e, f)) continue;
    const ev = e as FormEvent;
    const page = normalizePage(ev.url);
    const key = `${page}|${ev.form}`;
    let x = forms.get(key);
    if (!x)
      forms.set(
        key,
        (x = { page, form: ev.form, landed: 0, interacted: 0, submitted: 0, fields: new Map() }),
      );
    x.landed++;
    if (!ev.interacted) continue;
    x.interacted++;
    if (ev.submitted) x.submitted++;
    for (const fd of ev.fields) {
      let a = x.fields.get(fd.name);
      if (!a)
        x.fields.set(
          fd.name,
          (a = {
            name: fd.name,
            kind: fd.kind,
            focused: 0,
            time: 0,
            hesitation: 0,
            hesitations: 0,
            refilled: 0,
            ignored: 0,
            dropoffs: 0,
            filled: 0,
          }),
        );
      if (fd.focus > 0) {
        a.focused++;
        a.time += fd.time;
        if (fd.refills > 0) a.refilled++;
      } else a.ignored++;
      if (fd.hesitation !== undefined) {
        a.hesitation += fd.hesitation;
        a.hesitations++;
      }
      if (fd.filled) a.filled++;
    }
    if (!ev.submitted && ev.lastField) {
      const a = x.fields.get(ev.lastField);
      if (a) a.dropoffs++;
    }
  }
  return [...forms.values()]
    .map((x) => {
      const abandons = x.interacted - x.submitted;
      const fields = [...x.fields.values()].map((a) => ({
        name: a.name,
        kind: a.kind,
        avgTime: a.focused ? Math.round(a.time / a.focused) : 0,
        avgHesitation: a.hesitations ? Math.round(a.hesitation / a.hesitations) : 0,
        refillRate: a.focused ? a.refilled / a.focused : 0,
        ignoredRate: x.interacted ? a.ignored / x.interacted : 0,
        dropoffs: a.dropoffs,
        dropoffRate: abandons ? a.dropoffs / abandons : 0,
      }));
      return {
        page: x.page,
        form: x.form,
        landed: x.landed,
        interacted: x.interacted,
        submitted: x.submitted,
        /** Tempo médio de preenchimento: soma dos tempos médios dos campos. */
        avgFillTime: fields.reduce((s, f) => s + f.avgTime, 0),
        fields,
      };
    })
    .sort((a, b) => b.landed - a.landed);
}
