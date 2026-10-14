// Entra no bundle do snippet: manter pequeno e sem dependências.
import type { Fingerprint, Target } from '@abtest/shared';

export interface Resolution {
  el: Element;
  via: 'primary' | 'alternate' | 'fingerprint';
  /** Seletor que encontrou o elemento (para fingerprint, um caminho nth-of-type do elemento achado). */
  selector: string;
}

function query(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** Pontua o quanto `el` se parece com a impressão digital. */
export function scoreFingerprint(el: Element, fp: Fingerprint): number {
  let score = 0;
  const text = norm(el.textContent);
  if (fp.text && text === fp.text) score += 3;
  else if (fp.text && text && (text.includes(fp.text) || fp.text.includes(text))) score += 1;
  for (const [k, v] of Object.entries(fp.attrs)) {
    const cur = el.getAttribute(k);
    if (cur === v) score += k === 'id' || k.startsWith('data-') ? 2 : 1;
  }
  if (fp.pos.w || fp.pos.h) {
    const r = el.getBoundingClientRect();
    const win = el.ownerDocument.defaultView;
    const d = Math.hypot(r.left + (win?.scrollX ?? 0) - fp.pos.x, r.top + (win?.scrollY ?? 0) - fp.pos.y);
    if (d < 50) score += 1;
    else if (d < 200) score += 0.5;
  }
  return score;
}

/** Pontuação mínima e vantagem sobre o 2º colocado para aceitar uma cura por impressão digital. */
const MIN_SCORE = 3;
const MIN_MARGIN = 1;

export function findByFingerprint(root: ParentNode, fp: Fingerprint): Element | null {
  let best: Element | null = null;
  let bestScore = -1;
  let second = -1;
  for (const el of root.querySelectorAll(fp.tag)) {
    const s = scoreFingerprint(el, fp);
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = el;
    } else if (s > second) second = s;
  }
  return bestScore >= MIN_SCORE && bestScore - second >= MIN_MARGIN ? best : null;
}

/** Caminho nth-of-type curto (até um ancestral com id) para relatar o seletor curado. */
export function pathOf(el: Element): string {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur.parentElement; cur = cur.parentElement) {
    if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const same = [...cur.parentElement.children].filter((c) => c.tagName === cur!.tagName);
    const tag = cur.tagName.toLowerCase();
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
  }
  return parts.join(' > ');
}

/** Resolve o alvo: seletor principal → alternativos → impressão digital. */
export function resolveTarget(target: Target, root: ParentNode = document): Resolution | null {
  const primary = query(root, target.selector);
  if (primary) return { el: primary, via: 'primary', selector: target.selector };
  for (const alt of target.alternates ?? []) {
    const el = query(root, alt);
    if (el) return { el, via: 'alternate', selector: alt };
  }
  if (target.fingerprint) {
    const el = findByFingerprint(root, target.fingerprint);
    if (el) return { el, via: 'fingerprint', selector: pathOf(el) };
  }
  return null;
}
