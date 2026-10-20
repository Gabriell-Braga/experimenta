import {
  Activity,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Flame,
  Filter,
  Fingerprint,
  FlaskConical,
  Grid3x3,
  History,
  KeyRound,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareText,
  Rocket,
  Route,
  Server,
  ShoppingBag,
  Settings2,
  ShieldCheck,
  ToggleRight,
  UserRoundCog,
  Users,
  Video,
  X,
  type LucideIcon,
  Plug,
  LayoutDashboard,
  BrainCircuit,
  Sparkles,
  Check,
  Plus,
  UserPlus,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  APPROVALS_CHANGED,
  approvals,
  createAccount,
  getAccountSettings,
  saveAccountSettings,
  signOut,
  switchAccount,
  type Me,
} from './api';
import { navigate } from './nav';
import { approvalBadge } from './pages/Approvals';
import { Button, inputCls, Logo, Modal, useToast } from './ui';

export interface NavItem {
  view: string;
  label: string;
  icon: LucideIcon;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Menu lateral por módulo. `tela:tipo` filtra a lista de campanhas por tipo. Cada tela entra quando fica pronta. */
export const NAV: NavGroup[] = [
  { label: 'Visão geral', items: [{ view: 'home', label: 'Painel', icon: LayoutDashboard }] },
  {
    label: 'Testes',
    items: [
      { view: 'tests', label: 'Experimentos', icon: FlaskConical },
      { view: 'tests:personalization', label: 'Personalização', icon: UserRoundCog },
      { view: 'tests:rollout', label: 'Rollouts', icon: Rocket },
      { view: 'tests:server', label: 'Server-side', icon: Server },
      { view: 'flags', label: 'Feature flags', icon: ToggleRight },
      { view: 'optimize', label: 'Otimização por IA', icon: Sparkles },
    ],
  },
  {
    label: 'Insights',
    items: [
      { view: 'heatmaps', label: 'Mapas de calor', icon: Flame },
      { view: 'recordings', label: 'Gravações', icon: Video },
      { view: 'forms', label: 'Formulários', icon: ClipboardList },
      { view: 'funnels', label: 'Funis', icon: Filter },
      { view: 'journeys', label: 'Jornadas', icon: Route },
      { view: 'cohorts', label: 'Coortes', icon: Grid3x3 },
      { view: 'predictive', label: 'Preditivo', icon: BrainCircuit },
    ],
  },
  {
    label: 'Engajamento',
    items: [
      { view: 'popups', label: 'Pop-ups e barras', icon: Megaphone },
      { view: 'surveys', label: 'Pesquisas', icon: MessageSquareText },
      { view: 'recos', label: 'Recomendações', icon: ShoppingBag },
    ],
  },
  {
    label: 'Dados',
    items: [
      { view: 'events', label: 'Eventos', icon: Activity },
      { view: 'audiences', label: 'Audiências', icon: Users },
      { view: 'profiles', label: 'Perfis', icon: Fingerprint },
      { view: 'segments', label: 'Segmentos', icon: Boxes },
    ],
  },
  {
    label: 'Configurar',
    items: [
      { view: 'install', label: 'Instalação', icon: Code2 },
      { view: 'integrations', label: 'Integrações', icon: Plug },
      { view: 'privacy', label: 'Privacidade', icon: ShieldCheck },
      { view: 'team', label: 'Equipe', icon: UserPlus },
      { view: 'security', label: 'Segurança', icon: KeyRound },
      { view: 'approvals', label: 'Aprovações', icon: ClipboardCheck },
      { view: 'activity', label: 'Atividades', icon: History },
    ],
  },
];

/** Configurações da conta (só owner): amostragem do mapa de calor. */
export function AccountSettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [pct, setPct] = useState<string | null>(null); // null = carregando; '' = padrão do servidor
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPct(null);
    getAccountSettings().then(
      (s) => setPct(s.heatmapSampleRate === null ? '' : String(s.heatmapSampleRate * 100)),
      (e: Error) => toast('error', e.message),
    );
  }, [open, toast]);
  const save = async () => {
    const n = Number(pct);
    if (pct !== '' && !(n >= 0 && n <= 100)) return toast('error', 'Use um número de 0 a 100.');
    setBusy(true);
    try {
      await saveAccountSettings({ heatmapSampleRate: pct === '' ? null : n / 100 });
      toast('success', 'Salvo. Vale a partir da próxima publicação.');
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configurações da conta"
      testId="account-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="account-save">
            Salvar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Insights: % de visitantes com captura</span>
        <input
          type="number"
          min={0}
          max={100}
          step="any"
          disabled={pct === null}
          value={pct ?? ''}
          placeholder="padrão do servidor"
          onChange={(e) => setPct(e.target.value)}
          className={inputCls}
          data-testid="heatmap-rate"
        />
        <span className="text-xs text-gray-500">
          Vale para mapa de calor, cliques de frustração, formulários e gravações. 0 desliga. Vazio usa o
          padrão do servidor. Menos visitantes = menos eventos (e custo).
        </span>
      </label>
    </Modal>
  );
}

/** Nova conta (base do SaaS): quem cria vira owner e já entra nela. */
function NewAccountModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova conta"
      testId="new-account-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="new-account-form" variant="primary" loading={busy}>
            Criar conta
          </Button>
        </>
      }
    >
      <form
        id="new-account-form"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await createAccount(String(f.get('name')).trim(), new URL(String(f.get('site'))).href);
            location.href = location.pathname;
          } catch (err) {
            toast('error', (err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Nome da conta</span>
          <input name="name" required maxLength={200} placeholder="Ex.: Loja da Ana" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Endereço do site</span>
          <input
            name="site"
            type="url"
            required
            placeholder="https://www.exemplo.com/"
            className={inputCls}
          />
          <span className="text-xs text-gray-500">
            Conta separada: testes, dados, equipe e snippet próprios. Você entra como owner.
          </span>
        </label>
      </form>
    </Modal>
  );
}

function UserMenu({ user }: { user: Me }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [creating, setCreating] = useState(false);
  const accounts = user.accounts ?? [];
  const current = accounts.find((a) => a.id === user.accountId);
  const switchTo = async (id: string) => {
    try {
      await switchAccount(id);
      location.href = location.pathname; // recarrega: nenhuma tela fica com dado da conta anterior
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="relative">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-full min-w-52 rounded-md border border-gray-900/10 bg-white p-1 text-sm text-gray-800 shadow-xl"
        >
          <div className="px-3 py-2 text-xs text-gray-500">
            {user.email}
            <br />
            Papel: <b className="text-gray-700">{user.role}</b>
          </div>
          <div className="border-y border-gray-900/[0.07] py-1" data-testid="account-list">
            <p className="px-3 pt-1 pb-0.5 font-mono text-[10px] tracking-[0.12em] text-gray-400 uppercase">
              Contas
            </p>
            {accounts.map((a) => (
              <button
                key={a.id}
                role="menuitemradio"
                aria-checked={a.id === user.accountId}
                onClick={() => (a.id === user.accountId ? setOpen(false) : switchTo(a.id))}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-gray-100"
              >
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {a.id === user.accountId ? (
                  <Check size={14} className="text-brand-600" aria-hidden="true" />
                ) : (
                  <span className="text-[11px] text-gray-400">{a.role}</span>
                )}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-gray-600 hover:bg-gray-100"
              data-testid="new-account"
            >
              <Plus size={14} aria-hidden="true" /> Nova conta
            </button>
          </div>
          {user.role === 'owner' && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAccount(true);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-gray-100"
              data-testid="account-settings"
            >
              <Settings2 size={14} aria-hidden="true" /> Configurações da conta
            </button>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              await signOut();
              location.href = location.pathname;
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-gray-100"
          >
            <LogOut size={14} aria-hidden="true" /> Sair
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-white/[0.06]"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-lime font-mono text-[11px] font-semibold text-ink">
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-white">{user.name}</span>
          <span
            className="block truncate font-mono text-[10.5px] text-white/45"
            data-testid="current-account"
          >
            {current?.name ?? `conta ${user.accountId}`}
          </span>
        </span>
      </button>
      <AccountSettingsModal open={account} onClose={() => setAccount(false)} />
      <NewAccountModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

const NAV_CLOSED = 'abt.nav.closed';

/** Contadores do menu: pedidos de aprovação (recarrega ao publicar/decidir e a cada minuto). */
function useApprovalBadge(user: Me): Record<string, number> {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      approvals.list().then(
        (list) => alive && setN(approvalBadge(list, user)),
        () => {},
      );
    void load();
    const timer = setInterval(load, 60_000);
    addEventListener(APPROVALS_CHANGED, load);
    return () => {
      alive = false;
      clearInterval(timer);
      removeEventListener(APPROVALS_CHANGED, load);
    };
  }, [user]);
  return { approvals: n };
}

/** Moldura das telas (exceto o editor visual): menu lateral escuro + conteúdo sobre papel. */
export function AppShell({ user, view, children }: { user: Me; view: string; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeGroup = NAV.find((g) => g.items.some((i) => i.view === view))?.label ?? null;
  // Grupos recolhidos pelo usuário (lembrados neste navegador); o da tela atual sempre abre.
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(NAV_CLOSED) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (label: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(NAV_CLOSED, JSON.stringify([...next]));
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return next;
    });
  const badges = useApprovalBadge(user);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMobileOpen(false);
    if (activeGroup)
      setClosed((prev) =>
        prev.has(activeGroup) ? new Set([...prev].filter((l) => l !== activeGroup)) : prev,
      );
    // Item ativo sempre à vista quando o menu rola.
    requestAnimationFrame(() =>
      scroller.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest' }),
    );
  }, [view, activeGroup]);
  const sidebar = (
    <nav className="flex h-full flex-col bg-ink text-white" aria-label="Módulos">
      <div className="flex h-16 items-center justify-between px-4">
        <button onClick={() => navigate('tests')} aria-label="Início">
          <Logo dark />
        </button>
        <button className="text-white/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Fechar">
          <X size={18} />
        </button>
      </div>
      <div ref={scroller} className="nav-scroll flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => {
          const open = g.items.length === 1 || !closed.has(g.label);
          const hasActive = g.items.some((i) => i.view === view);
          return (
            <div key={g.label} data-nav-group={g.label}>
              {g.items.length > 1 && (
                <button
                  onClick={() => toggle(g.label)}
                  aria-expanded={open}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] uppercase hover:text-white/70 ${hasActive && !open ? 'text-lime' : 'text-white/35'}`}
                >
                  {g.label}
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={`transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                </button>
              )}
              <ul className="space-y-0.5 pb-1" hidden={!open}>
                {g.items.map(({ view: v, label, icon: Icon }) => {
                  const active = v === view;
                  return (
                    <li key={v}>
                      <button
                        onClick={() => {
                          const [screen, type] = v.split(':');
                          navigate(screen!, type ? { type } : {});
                        }}
                        aria-current={active ? 'page' : undefined}
                        data-testid={`nav-${v}`}
                        className={`group relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] ${active ? 'bg-white/[0.08] text-white' : 'text-white/60 hover:bg-white/[0.04] hover:text-white'}`}
                      >
                        {active && (
                          <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-lime" />
                        )}
                        <Icon
                          size={16}
                          aria-hidden="true"
                          className={active ? 'text-lime' : 'text-white/45 group-hover:text-white/80'}
                        />
                        {label}
                        {!!badges[v] && (
                          <span
                            className="ml-auto rounded-full bg-lime px-1.5 font-mono text-[10.5px] font-semibold text-ink"
                            aria-label={`${badges[v]} novos`}
                            data-testid={`nav-badge-${v}`}
                          >
                            {badges[v]}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/[0.08] p-2.5">
        <UserMenu user={user} />
      </div>
    </nav>
  );
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 md:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex h-12 items-center gap-3 border-b border-gray-900/10 px-4 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <Logo />
        </div>
        <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
