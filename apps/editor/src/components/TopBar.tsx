import {
  ArrowLeft,
  BarChart3,
  Eye,
  Flame,
  Link2,
  Monitor,
  MousePointerClick,
  Pencil,
  Redo2,
  Settings,
  Smartphone,
  Tablet,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { CampaignType, MvtSection, Variation } from '@abtest/shared';
import type { Action } from '../store';
import { CAMPAIGNS } from '../campaigns';
import { useState, type ReactNode } from 'react';
import { Button, Spinner, StatusBadge, timeAgo } from '../ui';

export type Mode = 'edit' | 'browse' | 'preview' | 'heatmap';
export type Device = 'desktop' | 'tablet' | 'mobile';

export const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' };

interface Props {
  /** MVT: seções e opções no lugar das abas de variação. */
  sections?: MvtSection[];
  onMvt?(a: Action): void;
  name: string;
  status: string;
  type: CampaignType;
  variations: Variation[];
  activeId: string;
  mode: Mode;
  device: Device;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  savedAt: string | null;
  connected: boolean;
  url: string;
  onBack(): void;
  onRename(name: string): void;
  onSelectVariation(id: string): void;
  onAddVariation(): void;
  onMode(m: Mode): void;
  onDevice(d: Device): void;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onPublish(): void;
  onSettings(): void;
  onReport(): void;
  /** Link de pré-visualização do rascunho da variação (17.3). */
  onPreviewLink(): void;
  /** Botão de agendamento (17.4), com o próximo agendado. */
  schedule?: ReactNode;
  onUrl(url: string): void;
}

const MODES: [Mode, string, LucideIcon][] = [
  ['edit', 'Editar', Pencil],
  ['browse', 'Navegar', MousePointerClick],
  ['preview', 'Preview', Eye],
  ['heatmap', 'Mapa de calor', Flame],
];
const DEVICES: [Device, string, LucideIcon][] = [
  ['desktop', 'Desktop', Monitor],
  ['tablet', 'Tablet', Tablet],
  ['mobile', 'Celular', Smartphone],
];

const seg = (active: boolean) =>
  `flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
    active ? 'bg-ink text-white' : 'text-gray-600 hover:text-gray-900'
  }`;

/** Abas do MVT: cada seção com suas opções (a 1ª é o original); duplo clique renomeia. */
function MvtTabs({
  sections,
  activeId,
  onSelect,
  onMvt,
}: {
  sections: MvtSection[];
  activeId: string;
  onSelect(id: string): void;
  onMvt(a: Action): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const name = (id: string, value: string, cls: string) =>
    renaming === id ? (
      <input
        autoFocus
        defaultValue={value}
        aria-label="Novo nome"
        className="w-28 rounded border border-gray-300 px-1 py-0.5 text-sm"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== value) onMvt({ type: 'renameMvt', id, name: v });
          setRenaming(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    ) : (
      <span className={cls} onDoubleClick={() => setRenaming(id)} title="Duplo clique para renomear">
        {value}
      </span>
    );
  return (
    <nav
      className="flex items-center gap-3 overflow-x-auto"
      aria-label="Seções do multivariado"
      data-testid="mvt-tabs"
    >
      {sections.map((sec) => (
        <span
          key={sec.id}
          className="flex items-center gap-1 rounded-md border border-gray-900/10 py-0.5 pr-0.5 pl-2"
          data-testid="mvt-section"
        >
          {name(sec.id, sec.name, 'label-mono mr-1 cursor-text')}
          {sec.options.map((o, i) => (
            <button
              key={o.id}
              role="tab"
              aria-selected={o.id === activeId}
              onClick={() => onSelect(o.id)}
              data-testid="mvt-option"
              className={`flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[13px] whitespace-nowrap ${o.id === activeId ? 'bg-lime-soft font-medium text-ink ring-1 ring-brand-200' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {name(o.id, o.name, '')}
              {o.operations.length > 0 && (
                <span className="tabular font-mono text-[11px] text-gray-500">({o.operations.length})</span>
              )}
              {i > 0 && sec.options.length > 2 && o.id === activeId && (
                <span
                  role="button"
                  aria-label="Remover opção"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMvt({ type: 'removeMvt', id: o.id });
                  }}
                  className="text-gray-400 hover:text-signal"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => onMvt({ type: 'addOption', sectionId: sec.id })}
            className="rounded px-1.5 text-sm text-gray-500 hover:bg-gray-100"
            title="Nova opção nesta seção"
            data-testid="mvt-add-option"
          >
            +
          </button>
        </span>
      ))}
      <button
        onClick={() => onMvt({ type: 'addSection' })}
        className="rounded-md px-2 py-1 text-sm whitespace-nowrap text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        data-testid="mvt-add-section"
      >
        + Seção
      </button>
    </nav>
  );
}

export function TopBar(p: Props) {
  const [editingName, setEditingName] = useState(false);
  return (
    <header className="border-b border-gray-900/10 bg-white">
      {/* Linha 1 (tinta): navegação, nome, estado e ações principais */}
      <div className="flex h-14 items-center gap-3 bg-ink px-3 text-white">
        <Button
          variant="inverse"
          size="sm"
          onClick={p.onBack}
          title="Voltar aos experimentos"
          data-testid="back"
        >
          <ArrowLeft size={15} aria-hidden="true" /> <span className="hidden sm:inline">Experimentos</span>
        </Button>
        <span className="h-6 w-px bg-white/15" />
        {editingName ? (
          <input
            autoFocus
            defaultValue={p.name}
            aria-label="Nome do experimento"
            className="min-w-0 rounded-md border border-white/30 bg-white/10 px-2 py-1 font-display text-lg text-white"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== p.name) p.onRename(v);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingName(false);
            }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="min-w-0 truncate rounded-md px-1 font-display text-lg hover:bg-white/10"
            title="Renomear"
            data-testid="experiment-name"
          >
            {p.name}
          </button>
        )}
        <StatusBadge status={p.status} />
        <span className="hidden font-mono text-[11px] text-white/50 sm:inline">
          {CAMPAIGNS[p.type].label}
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <Button
            variant="inverse"
            size="sm"
            onClick={p.onUndo}
            disabled={!p.canUndo}
            data-testid="undo"
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 size={15} aria-hidden="true" /> <span className="hidden xl:inline">Desfazer</span>
          </Button>
          <Button
            variant="inverse"
            size="sm"
            onClick={p.onRedo}
            disabled={!p.canRedo}
            data-testid="redo"
            title="Refazer (Ctrl+Shift+Z)"
          >
            <Redo2 size={15} aria-hidden="true" /> <span className="hidden xl:inline">Refazer</span>
          </Button>
        </div>

        <span
          className="hidden font-mono text-[11px] whitespace-nowrap text-white/50 md:inline"
          aria-live="polite"
          data-testid="save-state"
        >
          {p.saving ? (
            'Salvando…'
          ) : p.dirty ? (
            <span className="flex items-center gap-1.5 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Alterações não salvas
            </span>
          ) : p.savedAt ? (
            `Salvo ${timeAgo(p.savedAt)}`
          ) : (
            'Tudo salvo'
          )}
        </span>
        <Button
          variant="inverse"
          onClick={p.onReport}
          data-testid="open-report"
          title="Resultados do experimento"
        >
          <BarChart3 size={15} aria-hidden="true" /> <span className="hidden lg:inline">Relatório</span>
        </Button>
        <Button
          variant="inverseOutline"
          onClick={p.onPreviewLink}
          data-testid="open-preview-links"
          title="Link de pré-visualização: mostra o rascunho no site, sem publicar"
        >
          <Link2 size={15} aria-hidden="true" />{' '}
          <span className="hidden xl:inline">Link de pré-visualização</span>
        </Button>
        {p.schedule}
        <Button
          variant="inverseOutline"
          onClick={p.onSettings}
          data-testid="open-settings"
          title="Status, tráfego, páginas e metas"
        >
          <Settings size={15} aria-hidden="true" /> <span className="hidden lg:inline">Configurações</span>
        </Button>
        <Button
          variant="inverseOutline"
          onClick={p.onSave}
          disabled={!p.dirty}
          loading={p.saving}
          data-testid="save"
          title="Salvar (Ctrl+S)"
        >
          {p.saving ? 'Salvando…' : p.dirty ? 'Salvar' : 'Salvo'}
        </Button>
        <Button
          variant="accent"
          onClick={p.onPublish}
          loading={p.publishing}
          data-testid="publish"
          title="Salva e publica na CDN"
        >
          {p.publishing ? 'Publicando…' : 'Publicar'}
        </Button>
      </div>

      {/* Linha 2: variação, modo, dispositivo, página */}
      <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5">
        {p.sections ? (
          <MvtTabs
            sections={p.sections}
            activeId={p.activeId}
            onSelect={p.onSelectVariation}
            onMvt={p.onMvt!}
          />
        ) : (
          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Variações">
            {p.variations.map((v, i) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={v.id === p.activeId}
                data-testid={`tab-${v.key}`}
                onClick={() => p.onSelectVariation(v.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm whitespace-nowrap ${
                  v.id === p.activeId
                    ? 'bg-lime-soft font-medium text-ink ring-1 ring-brand-200'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span
                  className={`grid h-4 min-w-4 place-items-center rounded-sm px-0.5 font-mono text-[9px] font-semibold ${i === 0 ? 'bg-gray-200 text-gray-700' : 'bg-ink text-lime'}`}
                >
                  {i === 0 ? 'C' : `V${i}`}
                </span>
                {v.name}
                {v.operations.length > 0 && (
                  <span className="tabular font-mono text-[11px] text-gray-500">({v.operations.length})</span>
                )}
              </button>
            ))}
            {p.type !== 'rollout' && p.type !== 'mvt' && (
              <button
                onClick={p.onAddVariation}
                className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                title="Nova variação"
                data-testid="add-variation"
              >
                + Variação
              </button>
            )}
          </nav>
        )}

        <span className="h-5 w-px bg-gray-900/10" />
        <div
          className="flex rounded-md border border-gray-900/10 bg-gray-100 p-0.5"
          role="group"
          aria-label="Modo"
        >
          {MODES.map(([m, label, Icon]) => (
            <button
              key={m}
              className={seg(p.mode === m)}
              onClick={() => p.onMode(m)}
              data-testid={`mode-${m}`}
              aria-pressed={p.mode === m}
              title={label}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
        <div
          className="flex rounded-md border border-gray-900/10 bg-gray-100 p-0.5"
          role="group"
          aria-label="Dispositivo"
        >
          {DEVICES.map(([d, label, Icon]) => (
            <button
              key={d}
              className={seg(p.device === d)}
              onClick={() => p.onDevice(d)}
              data-testid={`device-${d}`}
              aria-pressed={p.device === d}
              title={label}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>

        <form
          className="flex min-w-48 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get('url');
            if (typeof v === 'string' && v) p.onUrl(v);
          }}
        >
          <span className="relative flex-1">
            <span
              className={`absolute top-1/2 left-2.5 h-2 w-2 -translate-y-1/2 rounded-full ${p.connected ? 'bg-brand-500' : 'animate-pulse bg-amber-400'}`}
              title={p.connected ? 'Conectado ao site' : 'Conectando…'}
            />
            <input
              name="url"
              defaultValue={p.url}
              key={p.url}
              aria-label="URL da página"
              className="w-full rounded-md border border-gray-200 bg-white py-1 pr-2 pl-6 font-mono text-xs text-gray-700 focus:border-brand-500 focus:outline-none"
            />
          </span>
        </form>
        <span
          className="text-xs whitespace-nowrap text-gray-500"
          data-testid="status"
          data-connected={p.connected}
        >
          {p.connected ? (
            'conectado'
          ) : (
            <span className="flex items-center gap-1">
              <Spinner className="h-3 w-3" /> conectando
            </span>
          )}
        </span>
      </div>
    </header>
  );
}
