import { Globe, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  createProject,
  listProjects,
  LOCALES,
  updateProject,
  type Locale,
  type Me,
  type Project,
} from '../api';
import { Button, EmptyState, inputCls, LoadingBlock, Modal, PageHeader, selectCls, useLoad } from '../ui';

const localeName = (l: Locale) => LOCALES.find(([k]) => k === l)?.[1] ?? l;

/** Janela de criar/editar site: nome, URL (o domínio sai dela) e localização. */
function SiteModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Project | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [form, setForm] = useState({ name: '', siteUrl: '', locale: 'pt-BR' as Locale });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      initial
        ? { name: initial.name, siteUrl: initial.siteUrl, locale: initial.locale }
        : { name: '', siteUrl: 'https://', locale: 'pt-BR' },
    );
  }, [open, initial]);
  let domain = '';
  try {
    domain = new URL(form.siteUrl).host;
  } catch {
    /* URL ainda incompleta */
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar site' : 'Novo site'}
      testId="site-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="site-form" variant="primary" loading={busy} data-testid="site-save">
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="site-form"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!domain) return setError('URL inválida: use o endereço completo, com https://.');
          setBusy(true);
          setError('');
          try {
            const body = { ...form, name: form.name.trim(), siteUrl: new URL(form.siteUrl).href };
            await (initial ? updateProject(initial.id, body) : createProject(body));
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Nome</span>
          <input
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ex.: Loja Brasil"
            className={inputCls}
            data-testid="site-name"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Site (URL da página inicial)</span>
          <input
            required
            type="url"
            value={form.siteUrl}
            onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
            placeholder="https://www.seusite.com.br/"
            className={inputCls}
            data-testid="site-url"
          />
        </label>
        <p className="text-xs text-gray-600">
          Domínio: <b className="font-mono">{domain || '—'}</b>. Experimentos só podem editar páginas dos
          domínios cadastrados aqui.
        </p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Localização</span>
          <select
            value={form.locale}
            onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}
            className={`${selectCls} w-full`}
            data-testid="site-locale"
          >
            {LOCALES.map(([k, label]) => (
              <option key={k} value={k}>
                {label} ({k})
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600" data-testid="site-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Sites do workspace (Configurar → Sites): onde os experimentos podem rodar. */
export function SitesPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Sites · Experimenta';
  }, []);
  const { data: sites, reload } = useLoad(listProjects, []);
  const [editing, setEditing] = useState<Project | null | 'new'>(null);
  const canEdit = user.role !== 'viewer';
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Sites"
        description="Os sites deste workspace: nome, domínio e localização. Um experimento só pode editar páginas destes domínios."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')} data-testid="site-new">
              <Plus size={15} aria-hidden="true" /> Novo site
            </Button>
          )
        }
      />
      {sites === null ? (
        <LoadingBlock className="mt-6" rows={3} />
      ) : !sites.length ? (
        <div className="mt-6 rounded-lg border border-gray-900/10 bg-white">
          <EmptyState icon={<Globe size={20} aria-hidden="true" />} title="Nenhum site cadastrado">
            Cadastre o site onde vão rodar os experimentos.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-900/10 bg-white">
          <table className="w-full text-left text-sm" data-testid="sites-table">
            <thead className="border-b border-gray-900/10 bg-gray-50">
              <tr className="label-mono">
                <th className="px-4 py-2.5 font-medium">Nome</th>
                <th className="px-4 py-2.5 font-medium">Domínio</th>
                <th className="px-4 py-2.5 font-medium">Site</th>
                <th className="px-4 py-2.5 font-medium">Localização</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900/[0.06]">
              {sites.map((s) => (
                <tr key={s.id} data-testid="site-row">
                  <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.domain}</td>
                  <td className="max-w-64 truncate px-4 py-3 font-mono text-xs text-gray-600">
                    <a href={s.siteUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {s.siteUrl}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {localeName(s.locale)} <span className="font-mono text-gray-400">{s.locale}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(s)}
                        aria-label={`Editar ${s.name}`}
                        data-testid="site-edit"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SiteModal
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    </>
  );
}
