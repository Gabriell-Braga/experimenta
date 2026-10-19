import { CircleAlert, CircleCheck, ExternalLink, Info, X } from 'lucide-react';
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
  primary: 'bg-ink text-white hover:bg-gray-800 shadow-[inset_0_-2px_0_rgb(0_0_0/0.35)]',
  accent: 'bg-lime text-ink hover:bg-[#c8e84a] shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]',
  secondary: 'bg-white text-gray-800 border border-gray-300 hover:border-gray-400 hover:bg-gray-50',
  ghost: 'text-gray-600 hover:bg-gray-900/5 hover:text-gray-900',
  danger: 'bg-signal text-white hover:bg-[#cf4520]',
  /** Sobre fundo tinta (barra do editor, menu lateral). */
  inverse: 'text-white/75 hover:bg-white/10 hover:text-white',
  inverseOutline: 'border border-white/20 text-white hover:border-white/40 hover:bg-white/10',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
      } ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ['Rascunho', 'bg-gray-100 text-gray-700 ring-gray-300'],
  running: ['Em execução', 'bg-lime-soft text-brand-900 ring-brand-200'],
  paused: ['Pausado', 'bg-amber-50 text-amber-800 ring-amber-200'],
  archived: ['Arquivado', 'bg-gray-50 text-gray-400 ring-gray-200'],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, STATUS.draft![1]];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide uppercase ring-1 ring-inset ${cls}`}
    >
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />}
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

function ToastIcon({ kind }: { kind: ToastKind }) {
  const cls = 'mt-0.5 shrink-0';
  if (kind === 'success')
    return <CircleCheck size={18} className={`${cls} text-green-600`} aria-hidden="true" />;
  if (kind === 'error') return <CircleAlert size={18} className={`${cls} text-red-600`} aria-hidden="true" />;
  return <Info size={18} className={`${cls} text-gray-500`} aria-hidden="true" />;
}

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
            className="animate-toast pointer-events-auto flex items-start gap-3 rounded-md border border-gray-900/10 bg-white p-3 text-sm shadow-[0_8px_24px_-8px_rgb(22_24_29/0.25)]"
          >
            <ToastIcon kind={t.kind} />
            <div className="min-w-0 flex-1 text-gray-800">
              {t.text}
              {t.action &&
                (t.action.href ? (
                  <a
                    href={t.action.href}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                  >
                    {t.action.label}
                    <ExternalLink size={13} aria-hidden="true" />
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
              <X size={16} />
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
      className="m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-900/10 p-0 shadow-2xl backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="font-display text-lg font-medium">{title}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
              <X size={16} />
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
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Marca: frasco dividido ao meio (controle | variação), metade papel e metade lima. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#16181d" />
      <path d="M18 7v6.2l5.4 9.2a2.4 2.4 0 0 1-2.1 3.6H16V7h2Z" fill="#d4f15b" />
      <path
        d="M12.5 7h7M14 7v6.2L8.6 22.4A2.4 2.4 0 0 0 10.7 26h10.6a2.4 2.4 0 0 0 2.1-3.6L18 13.2V7"
        fill="none"
        stroke="#f4f1ea"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span
        className={`font-display text-[19px] leading-none font-medium ${dark ? 'text-white' : 'text-ink'}`}
      >
        experimenta
      </span>
    </span>
  );
}

// ---------- Blocos de página ----------

/** Cabeçalho de página: etiqueta mono + título em serifa + descrição + ações à direita. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-900/10 pb-5">
      <div className="min-w-0">
        {eyebrow && <p className="label-mono mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[32px] leading-[1.05] font-normal text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`rounded-lg border border-gray-900/10 bg-white ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-900/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

/** Número grande com rótulo mono (KPIs). `tone` destaca positivo/negativo. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'up' | 'down';
}) {
  const color = tone === 'up' ? 'text-brand-600' : tone === 'down' ? 'text-signal' : 'text-ink';
  return (
    <div className="rounded-lg border border-gray-900/10 bg-white px-4 py-3">
      <p className="label-mono">{label}</p>
      <p className={`tabular mt-1.5 font-display text-[28px] leading-none ${color}`}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid-paper rounded-lg px-6 py-14 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-ink text-lime">{icon}</div>
      <p className="mt-4 font-display text-lg text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-gray-600">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Controle segmentado (filtros curtos). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-0.5 rounded-md border border-gray-900/10 bg-white p-0.5"
      role="tablist"
      aria-label={label}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`rounded-[5px] px-2.5 py-1 text-[13px] ${value === id ? 'bg-ink font-medium text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Formatação pt-BR usada nos relatórios. */
export const fmt = {
  int: (n: number) => n.toLocaleString('pt-BR'),
  pct: (n: number, d = 1) =>
    `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`,
  money: (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  /** ms → m:ss */
  dur: (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
};
