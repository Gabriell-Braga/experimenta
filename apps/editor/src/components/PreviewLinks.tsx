import { useState } from 'react';
import type { Variation } from '@abtest/shared';
import { previews } from '../api';
import { Button, Modal, selectCls, useCopy, useLoad, useToast } from '../ui';

const HOURS: [number, string][] = [
  [1, '1 hora'],
  [24, '24 horas'],
  [168, '7 dias'],
  [720, '30 dias'],
];

/**
 * Link de pré-visualização (17.3): qualquer pessoa com o link vê o RASCUNHO salvo de uma variação no site real,
 * sem publicar, até expirar ou ser revogado. O link completo só aparece na criação (a API guarda só o hash).
 */
export function PreviewLinks({
  onClose,
  experimentId,
  variations,
  activeId,
  dirty,
  onSave,
}: {
  onClose(): void;
  experimentId: string;
  variations: Variation[];
  activeId: string;
  dirty: boolean;
  /** Salva antes de criar: o link mostra o que está gravado na API. */
  onSave(): Promise<unknown>;
}) {
  const toast = useToast();
  const copy = useCopy();
  // MVT: a aba ativa é uma opção de seção, não uma variação; começa pela 1ª combinação.
  const [variation, setVariation] = useState(
    variations.some((v) => v.id === activeId) ? activeId : variations[0]!.id,
  );
  const [hours, setHours] = useState(24);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const links = useLoad(() => previews.list(experimentId), [experimentId]);

  const create = async () => {
    try {
      if (dirty) await onSave();
      const r = await previews.create(experimentId, variation, hours);
      setCreated(r);
      links.reload();
      void copy(r.url, 'Link copiado.');
    } catch (e) {
      toast('error', `Não foi possível criar o link: ${(e as Error).message}`);
    }
  };
  const revoke = async (id: string) => {
    try {
      await previews.revoke(experimentId, id);
      links.reload();
      toast('success', 'Link revogado.');
    } catch (e) {
      toast('error', `Não foi possível revogar: ${(e as Error).message}`);
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Modal open onClose={onClose} title="Link de pré-visualização" testId="preview-links">
      <p className="mb-3 text-sm text-gray-600">
        Quem abrir o link vê a variação como está salva agora, no site real, sem publicar e sem entrar nos
        relatórios. Navegar pelas páginas do site (ou do funil) mantém a pré-visualização.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Variação
          <select
            className={selectCls}
            value={variation}
            onChange={(e) => setVariation(e.target.value)}
            data-testid="preview-variation"
          >
            {variations.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Expira em
          <select
            className={selectCls}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            data-testid="preview-hours"
          >
            {HOURS.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={create} data-testid="preview-create">
          {dirty ? 'Salvar e criar link' : 'Criar link'}
        </Button>
      </div>
      {created && (
        <div className="mt-3 rounded-md bg-lime-soft p-3 text-sm">
          <div className="flex gap-2">
            <input
              readOnly
              value={created.url}
              onFocus={(e) => e.target.select()}
              aria-label="Link de pré-visualização"
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
              data-testid="preview-url"
            />
            <Button size="sm" onClick={() => copy(created.url, 'Link copiado.')}>
              Copiar
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-600">
            Válido até {when(created.expiresAt)}. Guarde agora: por segurança o link não é mostrado de novo.
          </p>
        </div>
      )}
      <h3 className="mt-4 mb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Links ativos</h3>
      {links.loading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : !links.data?.length ? (
        <p className="text-sm text-gray-500">Nenhum link ativo.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm" data-testid="preview-list">
          {links.data.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium">{l.variationName}</span>
                <span className="text-gray-500"> · expira {when(l.expiresAt)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => revoke(l.id)} data-testid="preview-revoke">
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
