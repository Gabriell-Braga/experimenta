import { renderPopup } from '@abtest/engage';
import { PopupSchema, type Popup } from '@abtest/shared';
import { Megaphone, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { entities, publish, query, type Entity, type Me } from '../api';
import { EngageFields, TRIGGER_LABEL } from '../components/EngageFields';
import {
  Button,
  EmptyState,
  fmt,
  inputCls,
  Modal,
  PageHeader,
  Segmented,
  LoadingBlock,
  selectCls,
  StatusBadge,
  useLoad,
  useToast,
} from '../ui';

export interface EngageStats {
  campaignId: string;
  views: number;
  viewers: number;
  clicks: number;
  closes: number;
  submits: number;
  ctr: number;
  responseRate: number;
}

const FORMATS = [
  ['modal', 'Pop-up'],
  ['slide-in', 'Slide-in'],
  ['bar-top', 'Barra topo'],
  ['bar-bottom', 'Barra rodapé'],
] as const;

/** Pré-visualização real (mesmo renderizador do site) dentro de uma "janela" do navegador. */
function Preview({ p }: { p: Popup }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = renderPopup(document, p);
    el.append(w.host);
    return () => w.remove();
  }, [p]);
  return (
    <div
      className="overflow-hidden rounded-md border border-gray-900/10 bg-white"
      data-testid="popup-preview"
    >
      <div className="flex items-center gap-1.5 border-b border-gray-900/10 bg-gray-50 px-3 py-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-gray-300" />
        ))}
        <span className="ml-2 font-mono text-[10.5px] text-gray-400">seu-site.com</span>
      </div>
      {/* transform cria o contexto: o position:fixed do widget fica preso a esta caixa. */}
      <div ref={box} className="grid-paper relative h-80" style={{ transform: 'translateZ(0)' }}>
        <div className="space-y-2 p-5">
          <div className="h-3 w-1/3 rounded bg-gray-200" />
          <div className="h-2 w-2/3 rounded bg-gray-100" />
          <div className="h-2 w-1/2 rounded bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

function PopupEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<Popup> | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [p, setP] = useState<Popup>(PopupSchema.parse({}));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setP(
      initial?.data ??
        PopupSchema.parse({
          title: 'Ganhe 10% na primeira compra',
          body: 'Use o cupom abaixo até o fim do dia.',
          code: 'BEMVINDO10',
          cta: { label: 'Ver ofertas', url: '/' },
          trigger: { type: 'exit' },
        }),
    );
  }, [open, initial]);
  const set = (o: Partial<Popup>) => setP({ ...p, ...o });
  const save = async (andPublish: boolean) => {
    setBusy(true);
    try {
      await entities.save('popup', {
        id: initial?.id,
        name: name.trim() || p.title || 'Pop-up',
        data: andPublish ? { ...p, status: 'running' } : p,
      });
      if (andPublish) await publish();
      toast('success', andPublish ? 'Publicado: aparece no site em até 1 min.' : 'Salvo.');
      onSaved();
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={initial ? 'Editar pop-up' : 'Novo pop-up'}
      testId="popup-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => save(false)} data-testid="popup-save">
            Salvar
          </Button>
          <Button variant="accent" loading={busy} onClick={() => save(true)} data-testid="popup-publish">
            Salvar e publicar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome interno"
            className={inputCls}
            data-testid="popup-name"
          />
          <Segmented
            label="Formato"
            value={p.format}
            onChange={(format) => set({ format })}
            options={FORMATS}
          />
          <label className="block text-sm">
            <span className="label-mono mb-1 block">Título</span>
            <input
              value={p.title}
              onChange={(e) => set({ title: e.target.value })}
              className={inputCls}
              data-testid="popup-title"
            />
          </label>
          <label className="block text-sm">
            <span className="label-mono mb-1 block">Texto</span>
            <textarea
              value={p.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Botão</span>
              <input
                value={p.cta?.label ?? ''}
                onChange={(e) =>
                  set({ cta: e.target.value ? { label: e.target.value, url: p.cta?.url } : undefined })
                }
                placeholder="sem botão"
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Link do botão</span>
              <input
                value={p.cta?.url ?? ''}
                onChange={(e) => p.cta && set({ cta: { ...p.cta, url: e.target.value || undefined } })}
                placeholder="/ofertas"
                className={`${inputCls} font-mono text-xs`}
              />
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Cupom (copiável)</span>
              <input
                value={p.code ?? ''}
                onChange={(e) => set({ code: e.target.value || undefined })}
                className={`${inputCls} font-mono`}
              />
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Imagem (URL)</span>
              <input
                value={p.image ?? ''}
                onChange={(e) => set({ image: e.target.value || undefined })}
                className={`${inputCls} font-mono text-xs`}
              />
            </label>
          </div>
          <div className="flex items-end gap-3">
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Tema</span>
              <select
                value={p.theme}
                onChange={(e) => set({ theme: e.target.value as Popup['theme'] })}
                className={selectCls}
              >
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
                <option value="brand">Cor de destaque</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="label-mono mb-1 block">Destaque</span>
              <input
                type="color"
                value={p.accent}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-9 w-14 rounded border border-gray-300"
              />
            </label>
          </div>
          <EngageFields<Popup> value={p} onChange={setP} />
        </div>
        <div className="space-y-2">
          <p className="label-mono">Pré-visualização</p>
          <Preview p={p} />
          <p className="text-xs text-gray-500">
            {TRIGGER_LABEL[p.trigger.type]} ·{' '}
            {p.frequency === 'once'
              ? 'uma vez por visitante'
              : p.frequency === 'session'
                ? 'uma vez por visita'
                : 'sempre'}
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function PopupsPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [editing, setEditing] = useState<Entity<Popup> | null | 'new'>(null);
  const { data: list, reload: reloadList } = useLoad(() => entities.list<Popup>('popup'), []);
  const { data: statsList, reload: reloadStats } = useLoad(
    () => query<EngageStats[]>('/analytics/engage', { days: 30 }).catch(() => []),
    [],
  );
  const stats = Object.fromEntries((statsList ?? []).map((s) => [s.campaignId, s]));
  const load = () => {
    reloadList();
    reloadStats();
  };
  useEffect(() => {
    document.title = 'Pop-ups · Experimenta';
  }, []);
  const toggle = async (e: Entity<Popup>) => {
    try {
      await entities.save('popup', {
        id: e.id,
        name: e.name,
        data: { ...e.data, status: e.data.status === 'running' ? 'paused' : 'running' },
      });
      await publish();
      toast('success', e.data.status === 'running' ? 'Pausado e retirado do site.' : 'No ar em até 1 min.');
      load();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Engajamento"
        title="Pop-ups e barras"
        description="Ofertas, avisos e captura de leads com gatilhos de comportamento: tempo, scroll, intenção de saída, inatividade ou clique."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-popup">
              <Plus size={16} aria-hidden="true" /> Novo pop-up
            </Button>
          )
        }
      />
      <div className="mt-6">
        {list === null || statsList === null ? (
          <LoadingBlock rows={4} />
        ) : !list.length ? (
          <EmptyState icon={<Megaphone size={20} aria-hidden="true" />} title="Nenhum pop-up ainda">
            Comece por um cupom na intenção de saída: costuma recuperar parte de quem ia embora.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-900/10 bg-white">
            <table className="w-full text-left text-sm" data-testid="popups">
              <thead className="border-b border-gray-900/10 bg-gray-50">
                <tr className="label-mono">
                  <th className="px-4 py-2.5 font-medium">Pop-up</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Gatilho</th>
                  <th className="px-4 py-2.5 text-right font-medium">Exibições</th>
                  <th className="px-4 py-2.5 text-right font-medium">CTR</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900/[0.06]">
                {list.map((e) => {
                  const s = stats[e.id];
                  return (
                    <tr key={e.id} data-testid="popup-row">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-ink">{e.name}</span>
                        <span className="font-mono text-[11px] text-gray-400">
                          {FORMATS.find((f) => f[0] === e.data.format)?.[1]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.data.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-gray-600 md:table-cell">
                        {TRIGGER_LABEL[e.data.trigger.type]}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-mono text-xs">
                        {fmt.int(s?.views ?? 0)}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-mono text-xs">
                        {s?.views ? fmt.pct(s.ctr, 1) : 'n/d'}
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        {canEdit && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggle(e)}
                              aria-label={e.data.status === 'running' ? 'Pausar' : 'Ativar'}
                            >
                              {e.data.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(e)}
                              aria-label="Editar"
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Excluir"
                              onClick={async () => {
                                await entities.remove('popup', e.id);
                                await publish().catch(() => {});
                                load();
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PopupEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </>
  );
}
