import { resolveTarget, type Resolution } from '@abtest/selector/resolve';
import type { Operation } from '@abtest/shared';
import { applyToElement, type Undo } from './operations';

export interface ApplyOptions {
  root?: Document;
  /** Tempo máximo de espera por elementos ausentes, contado a partir do DOMContentLoaded. */
  timeoutMs?: number;
  /**
   * Continua observando o DOM depois de aplicar tudo: se o framework trocar o nó alvo (re-render),
   * a operação é aplicada no nó novo. Só para quando `stop()` for chamado.
   */
  persist?: boolean;
  /** Chamado na primeira vez que cada operação é aplicada. */
  onApplied?: (op: Operation, res: Resolution) => void;
  /** Chamado no timeout para cada operação cujo alvo não foi encontrado. */
  onFailed?: (op: Operation) => void;
}

export interface ApplyReport {
  applied: { op: Operation; res: Resolution }[];
  failed: Operation[];
}

export interface ApplyHandle {
  /** Resolve quando todas as operações foram aplicadas ou quando o timeout expira. */
  done: Promise<ApplyReport>;
  /** Para de observar o DOM. */
  stop(): void;
  /** Para e desfaz tudo que este handle aplicou, na ordem inversa. */
  revert(): void;
}

/** Idempotência: elementos já processados por cada operação. Global para sobreviver a reaplicações (SPA). */
const processed = new Map<string, WeakSet<Element>>();

export function resetProcessed(): void {
  processed.clear();
}

/**
 * Aplica as operações em ordem. Alvos que ainda não existem são aguardados via MutationObserver
 * até `timeoutMs`; operações seguintes não esperam as pendentes.
 */
export function applyOperations(ops: Operation[], opts: ApplyOptions = {}): ApplyHandle {
  const doc = opts.root ?? document;
  const timeoutMs = opts.timeoutMs ?? 1500;
  const all = [...ops].sort((a, b) => a.order - b.order);
  const appliedIds = new Set<string>();
  const touched: { op: Operation; el: Element }[] = [];
  const undos: Undo[] = [];
  const report: ApplyReport = { applied: [], failed: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: (r: ApplyReport) => void;
  const done = new Promise<ApplyReport>((r) => (finish = r));
  let settled = false;
  let stopped = false;
  let running = false;
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(() => tryApply());

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    finish(report);
  };

  const stop = () => {
    stopped = true;
    observer.disconnect();
    settle();
  };

  const tryApply = () => {
    if (running || stopped) return;
    running = true;
    // Mutações causadas por nós mesmos não devem disparar nova rodada.
    observer.disconnect();
    for (const op of all) {
      if (!opts.persist && appliedIds.has(op.id)) continue;
      const res = resolveTarget(op.target, doc);
      const anchor = op.type === 'move' ? resolveTarget(op.value.anchor, doc) : null;
      if (!res || (op.type === 'move' && !anchor)) continue;
      let seen = processed.get(op.id);
      if (!seen) processed.set(op.id, (seen = new WeakSet()));
      if (!seen.has(res.el)) {
        seen.add(res.el);
        try {
          undos.push(applyToElement(op, res.el, anchor?.el));
          touched.push({ op, el: res.el });
        } catch {
          continue;
        }
      }
      if (!appliedIds.has(op.id)) {
        appliedIds.add(op.id);
        report.applied.push({ op, res });
        opts.onApplied?.(op, res);
      }
    }
    running = false;
    if (appliedIds.size === all.length) {
      settle();
      if (!opts.persist) return stop();
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  };

  const startTimeout = () => {
    if (settled) return;
    timer = setTimeout(() => {
      for (const op of all)
        if (!appliedIds.has(op.id)) {
          report.failed.push(op);
          opts.onFailed?.(op);
        }
      settle();
      if (!opts.persist) stop();
    }, timeoutMs);
  };

  tryApply();
  if (!settled) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', startTimeout, { once: true });
    else startTimeout();
  }

  return {
    done,
    stop,
    revert: () => {
      stop();
      for (const u of undos.splice(0).reverse()) u();
      for (const { op, el } of touched.splice(0)) processed.get(op.id)?.delete(el);
    },
  };
}
