import type { Variation } from '@abtest/shared';

export type Mode = 'edit' | 'browse' | 'preview';
export type Device = 'desktop' | 'tablet' | 'mobile';

export const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' };

interface Props {
  name: string;
  variations: Variation[];
  activeId: string;
  mode: Mode;
  device: Device;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  connected: boolean;
  url: string;
  onSelectVariation(id: string): void;
  onAddVariation(): void;
  onMode(m: Mode): void;
  onDevice(d: Device): void;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onPublish(): void;
  onUrl(url: string): void;
}

const seg = (active: boolean) =>
  `px-3 py-1 text-sm rounded-md ${active ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`;

export function TopBar(p: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
      <strong className="mr-2 text-gray-900">{p.name}</strong>

      <nav className="flex items-center gap-1" aria-label="Variações">
        {p.variations.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={v.id === p.activeId}
            data-testid={`tab-${v.key}`}
            onClick={() => p.onSelectVariation(v.id)}
            className={`rounded-t-md border-b-2 px-3 py-1 text-sm ${
              v.id === p.activeId ? 'border-orange-500 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            {v.name}
            {v.operations.length > 0 && (
              <span className="ml-1 text-xs text-gray-400">({v.operations.length})</span>
            )}
          </button>
        ))}
        <button
          onClick={p.onAddVariation}
          className="px-2 text-gray-500 hover:text-gray-900"
          title="Nova variação"
          data-testid="add-variation"
        >
          +
        </button>
      </nav>

      <div className="flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Modo">
        {(['edit', 'browse', 'preview'] as Mode[]).map((m) => (
          <button
            key={m}
            className={seg(p.mode === m)}
            onClick={() => p.onMode(m)}
            data-testid={`mode-${m}`}
            aria-pressed={p.mode === m}
          >
            {{ edit: 'Editar', browse: 'Navegar', preview: 'Preview' }[m]}
          </button>
        ))}
      </div>

      <div className="flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Dispositivo">
        {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
          <button
            key={d}
            className={seg(p.device === d)}
            onClick={() => p.onDevice(d)}
            data-testid={`device-${d}`}
            aria-pressed={p.device === d}
          >
            {{ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' }[d]}
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        <button
          onClick={p.onUndo}
          disabled={!p.canUndo}
          className="rounded px-2 py-1 text-sm disabled:opacity-40"
          data-testid="undo"
          title="Desfazer (Ctrl+Z)"
        >
          ↶ Desfazer
        </button>
        <button
          onClick={p.onRedo}
          disabled={!p.canRedo}
          className="rounded px-2 py-1 text-sm disabled:opacity-40"
          data-testid="redo"
          title="Refazer (Ctrl+Shift+Z)"
        >
          ↷ Refazer
        </button>
      </div>

      <form
        className="flex min-w-60 flex-1 items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get('url');
          if (typeof v === 'string' && v) p.onUrl(v);
        }}
      >
        <input
          name="url"
          defaultValue={p.url}
          key={p.url}
          aria-label="URL da página"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </form>

      <span
        className={`text-xs ${p.connected ? 'text-green-600' : 'text-gray-400'}`}
        data-testid="status"
        data-connected={p.connected}
      >
        {p.connected ? '● conectado' : '○ conectando…'}
      </span>
      <button
        onClick={p.onPublish}
        data-testid="publish"
        className="rounded-md border border-orange-500 px-3 py-1.5 text-sm font-medium text-orange-600"
        title="Salva e publica a configuração da conta na CDN"
      >
        Publicar
      </button>
      <button
        onClick={p.onSave}
        data-testid="save"
        className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        disabled={!p.dirty}
      >
        {p.dirty ? 'Salvar' : 'Salvo'}
      </button>
    </header>
  );
}
