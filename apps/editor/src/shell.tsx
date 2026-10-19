import {
  Activity,
  ClipboardList,
  Code2,
  Flame,
  Filter,
  FlaskConical,
  Grid3x3,
  LogOut,
  Menu,
  Rocket,
  Route,
  Server,
  Settings2,
  UserRoundCog,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { getAccountSettings, logout, saveAccountSettings, type Me } from './api';
import { navigate } from './nav';
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
  {
    label: 'Testes',
    items: [
      { view: 'tests', label: 'Experimentos', icon: FlaskConical },
      { view: 'tests:personalization', label: 'Personalização', icon: UserRoundCog },
      { view: 'tests:rollout', label: 'Rollouts', icon: Rocket },
      { view: 'tests:server', label: 'Server-side', icon: Server },
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
    ],
  },
  { label: 'Dados', items: [{ view: 'events', label: 'Eventos', icon: Activity }] },
  { label: 'Configurar', items: [{ view: 'install', label: 'Instalação', icon: Code2 }] },
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

function UserMenu({ user }: { user: Me }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
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
            onClick={() => {
              logout();
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
          <span className="block truncate font-mono text-[10.5px] text-white/45">conta {user.accountId}</span>
        </span>
      </button>
      <AccountSettingsModal open={account} onClose={() => setAccount(false)} />
    </div>
  );
}

/** Moldura das telas (exceto o editor visual): menu lateral escuro + conteúdo sobre papel. */
export function AppShell({ user, view, children }: { user: Me; view: string; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [view]);
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
      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.label}>
            <p className="mb-1.5 px-2 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
              {g.label}
            </p>
            <ul className="space-y-0.5">
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
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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
