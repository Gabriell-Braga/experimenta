import type { Question, Survey } from '@abtest/shared';

export type Answer = { questionId: string; value: number | string | string[] };

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.backdrop{position:fixed;inset:0;background:rgba(15,16,20,.48);display:grid;place-items:center;z-index:2147483646}
.card{position:relative;width:min(400px,calc(100vw - 32px));background:#fff;color:#16181d;border-radius:14px;padding:22px 20px 18px;box-shadow:0 24px 60px -18px rgba(0,0,0,.45);animation:rise .22s ease-out}
.slide{position:fixed;right:16px;bottom:16px;z-index:2147483646}
.step{font:500 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin:0 0 10px}
h2{margin:0 0 14px;font-size:16.5px;line-height:1.35;font-weight:650;padding-right:24px}
.scale{display:flex;gap:4px}
.scale button{flex:1;min-width:0;height:38px;border:1px solid #d7d3ca;background:#fff;border-radius:8px;font-size:14px;cursor:pointer;color:inherit}
.scale button[aria-pressed=true]{color:#fff;border-color:transparent}
.ends{display:flex;justify-content:space-between;font-size:11.5px;opacity:.6;margin-top:6px}
.opts{display:grid;gap:6px}
.opts label{display:flex;gap:9px;align-items:center;padding:9px 11px;border:1px solid #e3ded3;border-radius:9px;font-size:14px;cursor:pointer}
textarea{width:100%;min-height:84px;border:1px solid #d7d3ca;border-radius:9px;padding:9px 10px;font-size:14px;resize:vertical}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px}
.go{border:0;border-radius:9px;padding:9px 16px;font-size:14px;font-weight:600;color:#fff;cursor:pointer}
.go:disabled{opacity:.4;cursor:default}
.skip{border:0;background:none;font-size:13px;opacity:.6;cursor:pointer;color:inherit}
.x{position:absolute;top:8px;right:8px;width:30px;height:30px;border:0;border-radius:8px;background:transparent;opacity:.55;cursor:pointer;font-size:19px;color:inherit}
.thanks{font-size:15px;line-height:1.5;margin:6px 0 2px}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

/** Escala de cada tipo de nota: valores e rótulos das pontas. */
export const SCALES: Record<string, { values: number[]; low: string; high: string }> = {
  nps: { values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], low: 'Nada provável', high: 'Muito provável' },
  csat: { values: [1, 2, 3, 4, 5], low: 'Muito insatisfeito', high: 'Muito satisfeito' },
  ces: { values: [1, 2, 3, 4, 5, 6, 7], low: 'Muito difícil', high: 'Muito fácil' },
  rating: { values: [1, 2, 3, 4, 5], low: 'Ruim', high: 'Excelente' },
};

/** Próxima pergunta conforme a lógica (`end` encerra); sem regra que case, segue a ordem. */
export function nextIndex(s: Survey, i: number, value: Answer['value'] | undefined): number {
  const q = s.questions[i]!;
  if (value !== undefined)
    for (const r of q.logic) {
      const v = Array.isArray(value) ? value[0] : value;
      const hit =
        r.op === 'eq'
          ? String(v) === String(r.value)
          : r.op === 'lte'
            ? Number(v) <= Number(r.value)
            : Number(v) >= Number(r.value);
      if (hit) {
        if (r.goto === 'end') return s.questions.length;
        const j = s.questions.findIndex((x) => x.id === r.goto);
        if (j > i) return j;
      }
    }
  return i + 1;
}

/**
 * Pesquisa passo a passo num Shadow DOM. Chama `onDone(respostas, concluída)` uma vez: ao terminar ou ao
 * fechar no meio (respostas parciais). Textos por `textContent`.
 */
export function renderSurvey(
  doc: Document,
  s: Pick<Survey, 'questions' | 'thankYou' | 'accent' | 'format'>,
  h: { onDone(answers: Answer[], completed: boolean): void; onClose?(): void },
) {
  const host = doc.createElement('abt-engage');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const el = (tag: string, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const card = el('div', s.format === 'slide-in' ? 'card slide' : 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Pesquisa');
  const body = el('div');
  const x = el('button', 'x', '×');
  x.setAttribute('aria-label', 'Fechar pesquisa');
  card.append(body, x);
  const answers: Answer[] = [];
  let reported = false;
  const report = (completed: boolean) => {
    if (reported) return;
    reported = true;
    h.onDone(answers, completed);
  };
  const remove = () => host.remove();
  x.addEventListener('click', () => {
    report(false);
    remove();
    h.onClose?.();
  });

  const finish = () => {
    report(true);
    body.replaceChildren(el('p', 'thanks', s.thankYou));
    setTimeout(remove, 2500);
  };

  const show = (i: number) => {
    if (i >= s.questions.length) return finish();
    const q: Question = s.questions[i]!;
    let value: Answer['value'] | undefined;
    const go = el('button', 'go', i === s.questions.length - 1 ? 'Enviar' : 'Próxima') as HTMLButtonElement;
    go.style.background = s.accent;
    go.disabled = q.required;
    const pick = (v: Answer['value'] | undefined) => {
      value = v;
      go.disabled = q.required && (v === undefined || v === '' || (Array.isArray(v) && !v.length));
    };
    const nodes: Node[] = [el('p', 'step', `${i + 1} de ${s.questions.length}`), el('h2', '', q.text)];
    const scale = SCALES[q.type];
    if (scale) {
      const row = el('div', 'scale');
      row.setAttribute('role', 'radiogroup');
      for (const n of scale.values) {
        const b = el('button', '', String(n));
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          row.querySelectorAll('button').forEach((o) => {
            o.setAttribute('aria-pressed', 'false');
            (o as HTMLElement).style.background = '';
          });
          b.setAttribute('aria-pressed', 'true');
          b.style.background = s.accent;
          pick(n);
        });
        row.append(b);
      }
      const ends = el('div', 'ends');
      ends.append(el('span', '', scale.low), el('span', '', scale.high));
      nodes.push(row, ends);
    } else if (q.type === 'choice' || q.type === 'multi') {
      const box = el('div', 'opts');
      const name = `q${i}`;
      for (const o of q.options) {
        const lab = el('label');
        const inp = el('input') as HTMLInputElement;
        inp.type = q.type === 'choice' ? 'radio' : 'checkbox';
        inp.name = name;
        inp.value = o;
        inp.addEventListener('change', () => {
          const sel = [...box.querySelectorAll('input')]
            .filter((n) => (n as HTMLInputElement).checked)
            .map((n) => (n as HTMLInputElement).value);
          pick(q.type === 'choice' ? sel[0] : sel);
        });
        lab.append(inp, el('span', '', o));
        box.append(lab);
      }
      nodes.push(box);
    } else {
      const ta = el('textarea') as HTMLTextAreaElement;
      ta.maxLength = 2000;
      ta.setAttribute('aria-label', q.text);
      ta.addEventListener('input', () => pick(ta.value.trim()));
      nodes.push(ta);
    }
    const foot = el('div', 'foot');
    const skip = el('button', 'skip', q.required ? '' : 'Pular');
    if (!q.required) skip.addEventListener('click', () => show(nextIndex(s as Survey, i, undefined)));
    go.addEventListener('click', () => {
      if (value !== undefined && value !== '') answers.push({ questionId: q.id, value });
      show(nextIndex(s as Survey, i, value));
    });
    foot.append(skip, go);
    nodes.push(foot);
    body.replaceChildren(...nodes);
  };
  show(0);
  let wrap: HTMLElement = card;
  if (s.format === 'modal') {
    wrap = el('div', 'backdrop');
    wrap.append(card);
  }
  root.append(style, wrap);
  return { host, remove };
}
