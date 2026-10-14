// Primitivas de UI do app (sem biblioteca de componentes: só Tailwind).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
  secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 shadow-sm',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
} as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
      } ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ['Rascunho', 'bg-gray-100 text-gray-700 ring-gray-200'],
  running: ['Em execução', 'bg-green-50 text-green-700 ring-green-200'],
  paused: ['Pausado', 'bg-amber-50 text-amber-700 ring-amber-200'],
  archived: ['Arquivado', 'bg-gray-50 text-gray-400 ring-gray-200'],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, STATUS.draft![1]];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />}
      {label}
    </span>
  );
}

export const statusLabel = (s: string) => STATUS[s]?.[0] ?? s;

/** "há 3 min", "ontem"… */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ---------- Toasts ----------

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: ReactNode;
  action?: { label: string; href?: string; onClick?(): void };
}
type Push = (kind: ToastKind, text: ReactNode, action?: Toast['action']) => void;
const ToastCtx = createContext<Push>(() => {});
export const useToast = () => useContext(ToastCtx);

const ICON: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' };
const TONE: Record<ToastKind, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  info: 'bg-gray-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const close = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>(
    (kind, text, action) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
      setTimeout(() => close(id), kind === 'error' ? 8000 : 4500);
    },
    [close],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            data-testid={t.kind === 'error' ? 'toast-error' : 'notice'}
            className="animate-toast pointer-events-auto flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-lg"
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${TONE[t.kind]}`}
            >
              {ICON[t.kind]}
            </span>
            <div className="min-w-0 flex-1 text-gray-800">
              {t.text}
              {t.action &&
                (t.action.href ? (
                  <a
                    href={t.action.href}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 font-medium text-brand-600 hover:underline"
                  >
                    {t.action.label}
                  </a>
                ) : (
                  <button
                    onClick={t.action.onClick}
                    className="ml-1 font-medium text-brand-600 hover:underline"
                  >
                    {t.action.label}
                  </button>
                ))}
            </div>
            <button
              onClick={() => close(t.id)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal ----------

/** Modal sobre <dialog> nativo (foco, Esc e backdrop de graça). */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  testId,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-gray-900/40 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
              ✕
            </button>
          </header>
          <div className="px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-rose-500 text-xs font-bold text-white shadow-sm">
        A/B
      </span>
      Experimenta
    </span>
  );
}
