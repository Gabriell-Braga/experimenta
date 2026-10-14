import { resolveTarget, type Resolution } from '@abtest/selector/resolve';
import type { Operation } from '@abtest/shared';
import { applyToElement, type Undo } from './operations';

export interface ApplyOptions {
  root?: Document;
  /** Tempo máximo de espera por elementos ausentes, contado a partir do DOMContentLoaded. */
  timeoutMs?: number;
  /** Chamado quando a operação é aplicada (inclusive se já estava aplicada nesse elemento). */
  onApplied?: (op: Operation, res: Resolution) => void;
  /** Chamado no timeout para cada operação cujo alvo não foi encontrado. */
  onFailed?: (op: Operation) => void;
}

export interface ApplyReport {
  applied: { op: Operation; res: Resolution }[];
  failed: Operation[];
}

export interface ApplyHandle {
  done: Promise<ApplyReport>;
  /** Para de observar o DOM (operações pendentes não serão mais aplicadas nem reportadas). */
  stop(): void;
  /** Desfaz tudo que este handle aplicou, na ordem inversa. */
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
  const pending = [...ops].sort((a, b) => a.order - b.order);
  const undos: Undo[] = [];
  const report: ApplyReport = { applied: [], failed: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: (r: ApplyReport) => void;
  const done = new Promise<ApplyReport>((r) => (finish = r));
  let stopped = false;
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(() => tryApply());
  let running = false;

  const tryApply = () => {
    if (running || stopped) return;
    running = true;
    // Mutações causadas por nós mesmos não devem disparar nova rodada.
    observer.disconnect();
    for (let i = 0; i < pending.length;) {
      const op = pending[i]!;
      const res = resolveTarget(op.target, doc);
      const anchorRes = op.type === 'move' ? resolveTarget(op.value.anchor, doc) : null;
      if (!res || (op.type === 'move' && !anchorRes)) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      let seen = processed.get(op.id);
      if (!seen) processed.set(op.id, (seen = new WeakSet()));
      if (!seen.has(res.el)) {
        seen.add(res.el);
        try {
          undos.push(applyToElement(op, res.el, anchorRes?.el));
        } catch {
          report.failed.push(op);
          opts.onFailed?.(op);
          continue;
        }
      }
      report.applied.push({ op, res });
      opts.onApplied?.(op, res);
    }
    running = false;
    if (!pending.length) end();
    else observer.observe(doc.documentElement, { childList: true, subtree: true });
  };

  const end = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    finish(report);
  };

  const startTimeout = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      for (const op of pending.splice(0)) {
        report.failed.push(op);
        opts.onFailed?.(op);
      }
      end();
    }, timeoutMs);
  };

  tryApply();
  if (!stopped) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', startTimeout, { once: true });
    else startTimeout();
  }

  return {
    done,
    stop: () => {
      stopped = true;
      observer.disconnect();
      clearTimeout(timer);
      finish(report);
    },
    revert: () => {
      for (const u of undos.splice(0).reverse()) u();
      for (const { op, res } of report.applied) processed.get(op.id)?.delete(res.el);
    },
  };
}
