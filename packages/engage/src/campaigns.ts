import type { Popup, Survey, TrackingEvent } from '@abtest/shared';
import { matchAudience } from '@abtest/snippet/audience';
import type { EngageBoot } from '@abtest/snippet/engage';
import { matchUrl } from '@abtest/snippet/segment';
import { arm } from './triggers';
import { renderSurvey } from './survey';
import { renderPopup } from './widget';

type Campaign = (Popup | Survey) & { id: string; name: string };
type SurveyC = Survey & { id: string; name: string };
const SEEN = '_abt_seen';

function store(s: Storage | undefined) {
  const read = (): Record<string, number> => {
    try {
      return JSON.parse(s?.getItem(SEEN) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  };
  return {
    count: (id: string) => read()[id] ?? 0,
    add(id: string) {
      const m = read();
      m[id] = (m[id] ?? 0) + 1;
      try {
        s?.setItem(SEEN, JSON.stringify(m));
      } catch {
        /* storage bloqueado */
      }
    },
  };
}
const safe = <T>(f: () => T) => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

/** Campanha vale para esta página, dispositivo, audiências e limite de frequência? */
export function eligible(c: Campaign, boot: EngageBoot, seen: { local: number; session: number }): boolean {
  if (c.status !== 'running') return false;
  if (c.frequency === 'once' && seen.local > 0) return false;
  if (c.frequency === 'session' && seen.session > 0) return false;
  const ctx = boot.ctx();
  const t = c.targeting;
  if (t.urls.some((r) => r.exclude && matchUrl(r, ctx.url))) return false;
  const inc = t.urls.filter((r) => !r.exclude);
  if (inc.length && !inc.some((r) => matchUrl(r, ctx.url))) return false;
  if (t.devices.length && !t.devices.includes(ctx.device)) return false;
  const auds = new Map((boot.config.audiences ?? []).map((a) => [a.id, a]));
  return t.audiences.every((id) => {
    const a = auds.get(id);
    return !!a && matchAudience(a, ctx);
  });
}

/** Pop-ups e barras: avalia a cada página (e rota de SPA), arma o gatilho e mostra uma vez por vez. */
export function startEngage(win: Window, boot: EngageBoot) {
  const local = store(safe(() => win.localStorage));
  const session = store(safe(() => win.sessionStorage));
  let disarm: (() => void)[] = [];
  let showing: { remove(): void } | null = null;
  const send = (c: Campaign, kind: 'popup' | 'survey', action: 'view' | 'click' | 'close' | 'submit') =>
    boot.send({ ...boot.base(), type: 'engage', campaignId: c.id, kind, action } as TrackingEvent);

  const mount = (
    c: Campaign,
    w: { host: HTMLElement; remove(): void; focus?(): void },
    kind: 'popup' | 'survey',
  ) => {
    local.add(c.id);
    session.add(c.id);
    showing = w;
    (win.document.body ?? win.document.documentElement).append(w.host);
    w.focus?.();
    send(c, kind, 'view');
  };

  const showSurvey = (c: SurveyC) => {
    if (showing) return;
    const w = renderSurvey(win.document, c, {
      onDone: (answers, completed) => {
        if (completed) showing = null;
        if (answers.length)
          boot.send({ ...boot.base(), type: 'survey', surveyId: c.id, answers, completed } as TrackingEvent);
        if (completed) send(c, 'survey', 'submit');
        boot.flush();
      },
      onClose: () => {
        showing = null;
        send(c, 'survey', 'close');
      },
    });
    mount(c, w, 'survey');
  };

  const show = (c: Popup & { id: string; name: string }) => {
    if (showing) return; // um de cada vez
    const w = renderPopup(win.document, c, {
      onCta: () => {
        send(c, 'popup', 'click');
        boot.flush(); // o CTA costuma navegar
      },
      onClose: () => {
        showing = null;
        send(c, 'popup', 'close');
      },
    });
    mount(c, w, 'popup');
  };

  const evaluate = () => {
    disarm.forEach((f) => f());
    disarm = [];
    for (const c of boot.config.popups ?? [])
      if (eligible(c, boot, { local: local.count(c.id), session: session.count(c.id) }))
        disarm.push(arm(win, c.trigger, () => show(c)));
    for (const c of boot.config.surveys ?? [])
      if (eligible(c, boot, { local: local.count(c.id), session: session.count(c.id) }))
        disarm.push(arm(win, c.trigger, () => showSurvey(c)));
  };
  evaluate();
  boot.onNavigate.push(evaluate);
  return { evaluate, stop: () => disarm.forEach((f) => f()) };
}
