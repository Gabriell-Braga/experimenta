import { renderShelf } from '@abtest/engage';
import { RecoWidgetSchema, type RecoWidget } from '@abtest/shared';
import { Pause, Pencil, Play, Plus, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  API_URL,
  entities,
  type Entity,
  type Me,
  PENDING_TEXT,
  publish,
  publishedText,
  query,
  rebuildRecos,
} from '../api';
import { EngageFields, type EngageCommon } from '../components/EngageFields';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  Modal,
  LoadingBlock,
  PageHeader,
  selectCls,
  Skeleton,
  StatusBadge,
  useLoad,
  useToast,
} from '../ui';
import type { EngageStats } from './Popups';

export const STRATEGIES: [RecoWidget['strategy'], string, string][] = [
  ['coview', 'Quem viu também viu', 'Cross-sell por co-visualização com o último produto visto.'],
  ['copurchase', 'Comprados juntos', 'Cross-sell por produtos que saem na mesma compra.'],
  ['upsell', 'Upsell', 'Mesma categoria, preço maior que o produto visto.'],
  ['nbo', 'Próxima melhor oferta', 'Da categoria favorita do visitante, o que ele ainda não viu.'],
  ['trending', 'Em alta', 'Mais vistos nos últimos 7 dias.'],
  ['bestsellers', 'Mais vendidos', 'Mais comprados no período.'],
];

interface RecoItem {
  id: string;
  name: string;
  price?: number;
  url?: string;
  image?: string;
}

function Preview({ w, accountId }: { w: RecoWidget; accountId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { data: items } = useLoad(
    () =>
      fetch(`${API_URL}/reco/${accountId}/${w.strategy}?limit=${w.limit}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then(
          (d: { items: RecoItem[] }) => d.items,
          (): RecoItem[] => [],
        ),
    [accountId, w.strategy, w.limit],
  );
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !items?.length) return;
    const host = renderShelf(document, w, items, () => {});
    el.append(host);
    return () => host.remove();
  }, [items, w]);
  return (
    <div className="rounded-md border border-gray-900/10 bg-white p-3" data-testid="reco-preview">
      {!items && <Skeleton className="h-32 w-full" />}
      {items && !items.length && (
        <p className="py-8 text-center text-sm text-gray-400">
          Sem dados de produtos ainda: integre abq.push(['product', …]).
        </p>
      )}
      <div ref={box} />
    </div>
  );
}

function RecoEditor({
  open,
  initial,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Entity<RecoWidget> | null;
  user: Me;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [w, setW] = useState<RecoWidget>(RecoWidgetSchema.parse({ selector: '#produtos' }));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setW(initial?.data ?? RecoWidgetSchema.parse({ selector: '#produtos', strategy: 'coview' }));
  }, [open, initial]);
  const set = (o: Partial<RecoWidget>) => setW({ ...w, ...o });
  // Os campos de segmentação são os mesmos de pop-ups (gatilho/frequência não se aplicam à vitrine).
  const common = { ...w, trigger: { type: 'load' }, frequency: 'always' } as unknown as RecoWidget &
    EngageCommon;
  const save = async (andPublish: boolean) => {
    setBusy(true);
    try {
      await entities.save('reco', {
        id: initial?.id,
        name: name.trim() || 'Vitrine',
        data: andPublish ? { ...w, status: 'running' } : w,
      });
      toast(
        'success',
        andPublish ? publishedText(await publish(), 'Publicada: aparece no site em até 1 min.') : 'Salva.',
      );
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
      title={initial ? 'Editar vitrine' : 'Nova vitrine de recomendações'}
      testId="reco-editor"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => save(false)}>
            Salvar
          </Button>
          <Button variant="accent" loading={busy} onClick={() => save(true)} data-testid="reco-publish">
            Salvar e publicar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome interno"
            className={inputCls}
            data-testid="reco-name"
          />
          <fieldset className="space-y-1.5">
            <legend className="label-mono mb-1">Estratégia</legend>
            {STRATEGIES.map(([k, l, help]) => (
              <label
                key={k}
                className={`flex cursor-pointer gap-2 rounded-md border p-2 ${w.strategy === k ? 'border-ink bg-lime-soft/50' : 'border-gray-900/10'}`}
              >
                <input
                  type="radio"
                  name="strategy"
                  checked={w.strategy === k}
                  onChange={() => set({ strategy: k })}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-ink">{l}</span>
                  <span className="block text-xs text-gray-500">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="label-mono mb-1 block">Título</span>
            <input value={w.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="label-mono mb-1 block">Onde (seletor)</span>
              <input
                value={w.selector}
                onChange={(e) => set({ selector: e.target.value })}
                className={`${inputCls} font-mono text-xs`}
                data-testid="reco-selector"
              />
            </label>
            <label className="block">
              <span className="label-mono mb-1 block">Posição</span>
              <select
                value={w.position}
                onChange={(e) => set({ position: e.target.value as RecoWidget['position'] })}
                className={selectCls}
              >
                <option value="after">depois</option>
                <option value="before">antes</option>
                <option value="prepend">dentro (início)</option>
                <option value="append">dentro (fim)</option>
              </select>
            </label>
            <label className="block">
              <span className="label-mono mb-1 block">Itens</span>
              <input
                type="number"
                min={1}
                max={12}
                value={w.limit}
                onChange={(e) => set({ limit: Number(e.target.value) || 4 })}
                className={`${inputCls} w-16`}
              />
            </label>
          </div>
          <EngageFields<RecoWidget & EngageCommon>
            value={common}
            onChange={(v) => set({ targeting: v.targeting })}
          />
        </div>
        <div className="space-y-2">
          <p className="label-mono">Pré-visualização com o seu catálogo</p>
          <Preview w={w} accountId={user.accountId} />
        </div>
      </div>
    </Modal>
  );
}

export function RecosPage({ user }: { user: Me }) {
  const toast = useToast();
  const canEdit = user.role !== 'viewer';
  const [editing, setEditing] = useState<Entity<RecoWidget> | null | 'new'>(null);
  const [model, setModel] = useState<{ products: number; builtAt: string } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const { data: list, reload: reloadList } = useLoad(() => entities.list<RecoWidget>('reco'), []);
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
    document.title = 'Recomendações · Experimenta';
  }, []);
  const toggle = async (e: Entity<RecoWidget>) => {
    await entities.save('reco', {
      id: e.id,
      name: e.name,
      data: { ...e.data, status: e.data.status === 'running' ? 'paused' : 'running' },
    });
    if ('pending' in (await publish())) toast('info', PENDING_TEXT);
    load();
  };
  const api = `GET ${API_URL}/reco/${user.accountId}/coview?product=<id>&limit=4`;
  return (
    <>
      <PageHeader
        eyebrow="Engajamento"
        title="Recomendações"
        description="Cross-sell, upsell e próxima melhor oferta a partir do que os visitantes veem e compram. Vitrines no site e uma API para app, backend e e-mail."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="new-reco">
              <Plus size={16} aria-hidden="true" /> Nova vitrine
            </Button>
          )
        }
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          {list === null || statsList === null ? (
            <LoadingBlock rows={4} />
          ) : !list.length ? (
            <EmptyState icon={<ShoppingBag size={20} aria-hidden="true" />} title="Nenhuma vitrine ainda">
              Ex.: “Quem viu também viu” abaixo da grade de produtos, ou “Comprados juntos” no carrinho.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-900/10 bg-white">
              <table className="w-full text-left text-sm" data-testid="recos">
                <thead className="border-b border-gray-900/10 bg-gray-50">
                  <tr className="label-mono">
                    <th className="px-4 py-2.5 font-medium">Vitrine</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Exibições</th>
                    <th className="px-4 py-2.5 text-right font-medium">CTR</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/[0.06]">
                  {list.map((e) => {
                    const s = stats[e.id];
                    return (
                      <tr key={e.id} data-testid="reco-row">
                        <td className="px-4 py-3">
                          <span className="block font-medium text-ink">{e.name}</span>
                          <span className="font-mono text-[11px] text-gray-400">
                            {STRATEGIES.find((x) => x[0] === e.data.strategy)?.[1]} · {e.data.position}{' '}
                            {e.data.selector}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={e.data.status} />
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
                                  await entities.remove('reco', e.id);
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
        <div className="space-y-5">
          <Card
            title="Modelo"
            action={
              canEdit && (
                <Button
                  size="sm"
                  loading={rebuilding}
                  data-testid="reco-rebuild"
                  onClick={async () => {
                    setRebuilding(true);
                    try {
                      setModel(await rebuildRecos());
                    } catch (err) {
                      toast('error', (err as Error).message);
                    } finally {
                      setRebuilding(false);
                    }
                  }}
                >
                  <RefreshCw size={13} aria-hidden="true" /> Recalcular
                </Button>
              )
            }
          >
            <p className="text-sm text-gray-600">
              {model
                ? `${fmt.int(model.products)} produtos no catálogo · atualizado ${new Date(model.builtAt).toLocaleTimeString('pt-BR')}.`
                : 'Recalculado de hora em hora e a cada publicação, a partir dos últimos 60 dias.'}
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-[#e8e4da]">{`abq.push(['product', { id, name, price,
  category, url, image }]);
abq.push(['cart', id]);
abq.push(['purchase', [id1, id2], total]);`}</pre>
          </Card>
          <Card title="API de recomendações">
            <p className="text-xs text-gray-600">
              Para app, backend ou e-mail (pública, com cache de 1 min). Estratégias: coview, copurchase,
              upsell, nbo (com viewed=a,b), trending, bestsellers.
            </p>
            <code className="mt-2 block font-mono text-[11px] break-all text-ink">{api}</code>
          </Card>
        </div>
      </div>
      <RecoEditor
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        user={user}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </>
  );
}
