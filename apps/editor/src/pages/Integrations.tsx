import { WEBHOOK_EVENTS, type Integrations, type Webhook } from '@abtest/shared';
import { Copy, KeyRound, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiKeys, entities, publish, testWebhook, type ApiKey, type Entity, type Me } from '../api';
import { Button, Card, inputCls, PageHeader, selectCls, timeAgo, useCopy, useToast } from '../ui';
import { Switch } from './Flags';

const EVENT_LABEL: Record<(typeof WEBHOOK_EVENTS)[number], string> = {
  conversion: 'Conversão em teste',
  survey: 'Resposta de pesquisa',
  form: 'Formulário',
  engage: 'Pop-up / pesquisa exibidos',
  identify: 'Usuário identificado',
  event: 'Evento personalizado',
  publish: 'Publicação',
};

function NativeIntegrations({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [e, setE] = useState<Entity<Integrations> | null | undefined>(undefined);
  useEffect(() => {
    entities.list<Integrations>('integrations').then(
      (l) => setE(l[0] ?? null),
      () => setE(null),
    );
  }, []);
  const data = e?.data ?? { ga4: false, gtm: false };
  const set = async (p: Partial<Integrations>) => {
    try {
      const next = { ...data, ...p };
      const { id } = await entities.save('integrations', { id: e?.id, name: 'integrações', data: next });
      setE({ ...(e ?? ({} as Entity<Integrations>)), id, name: 'integrações', data: next });
      await publish();
      toast('success', 'Publicado: o snippet passa a enviar na próxima visita.');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const rows: [keyof Integrations, string, string][] = [
    ['ga4', 'Google Analytics 4', "gtag('event', 'experiment_impression', { experiment_id, variant_id })"],
    [
      'gtm',
      'Google Tag Manager',
      "dataLayer.push({ event: 'abt_exposure' | 'abt_conversion', abt_experiment, … })",
    ],
  ];
  return (
    <Card title="No navegador">
      <ul className="space-y-3">
        {rows.map(([k, label, how]) => (
          <li key={k} className="flex items-start gap-3">
            <Switch
              on={!!data[k]}
              onChange={(v) => canEdit && e !== undefined && set({ [k]: v })}
              label={label}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{label}</span>
              <code className="block break-all font-mono text-[11px] text-gray-500">{how}</code>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        Usa a tag que já está no seu site. Eventos de QA nunca saem.
      </p>
    </Card>
  );
}

function Webhooks({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const copy = useCopy();
  const [list, setList] = useState<Entity<Webhook>[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Webhook['events']>(['conversion']);
  const load = useCallback(() => entities.list<Webhook>('webhook').then(setList, () => {}), []);
  useEffect(() => void load(), [load]);
  const run = (p: Promise<unknown>) => p.then(load, (err: Error) => toast('error', err.message));
  const add = () =>
    run(
      entities.save('webhook', {
        name: url.replace(/^https?:\/\//, '').split('/')[0] || url,
        data: { url, events },
      }),
    ).then(() => setUrl(''));
  return (
    <Card title="Webhooks">
      <ul className="divide-y divide-gray-900/[0.06]" data-testid="webhooks">
        {list.map((h) => (
          <li key={h.id} className="flex items-center gap-3 py-2.5">
            <Switch
              on={h.data.enabled}
              onChange={(enabled) =>
                canEdit &&
                run(entities.save('webhook', { id: h.id, name: h.name, data: { ...h.data, enabled } }))
              }
              label={`Ativar ${h.data.url}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs text-ink">{h.data.url}</span>
              <span className="block truncate text-xs text-gray-500">
                {h.data.events.map((x) => EVENT_LABEL[x]).join(' · ')}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copiar segredo"
              title="Copiar segredo de assinatura"
              onClick={() => copy(h.data.secret, 'Segredo copiado.')}
            >
              <Copy size={14} />
            </Button>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Enviar teste"
                  onClick={async () => {
                    const { status } = await testWebhook(h.id);
                    toast(
                      status >= 200 && status < 300 ? 'success' : 'error',
                      `Destino respondeu ${status || 'sem conexão'}.`,
                    );
                  }}
                >
                  <Send size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Excluir"
                  onClick={() => run(entities.remove('webhook', h.id))}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </li>
        ))}
        {!list.length && (
          <li className="py-3 text-sm text-gray-500">
            Nenhum webhook. Mande eventos para CRM, Slack, Zapier…
          </li>
        )}
      </ul>
      {canEdit && (
        <div className="mt-3 space-y-2 border-t border-gray-900/[0.06] pt-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://seu-sistema.com/webhooks/experimenta"
            className={`${inputCls} font-mono text-xs`}
            data-testid="webhook-url"
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {WEBHOOK_EVENTS.map((x) => (
              <label key={x} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={events.includes(x)}
                  onChange={(e) =>
                    setEvents(e.target.checked ? [...events, x] : events.filter((y) => y !== x))
                  }
                  className="accent-[#12825f]"
                />
                {EVENT_LABEL[x]}
              </label>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!url || !events.length}
            onClick={() => add()}
            data-testid="webhook-add"
          >
            <WebhookIcon size={14} aria-hidden="true" /> Adicionar webhook
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        POST JSON com <code className="font-mono">X-Abt-Signature: sha256=HMAC(segredo, corpo)</code>.
      </p>
    </Card>
  );
}

function ApiKeys() {
  const toast = useToast();
  const [list, setList] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<ApiKey['role']>('viewer');
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => apiKeys.list().then(setList, () => {}), []);
  useEffect(() => void load(), [load]);
  const create = async () => {
    try {
      setCreated((await apiKeys.create(name, role)).key);
      setName('');
      void load();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Card title="Chaves de API">
      {created && (
        <div
          className="mb-3 rounded-md border border-brand-500/30 bg-brand-50 p-3 text-xs"
          data-testid="api-key-created"
        >
          <p className="mb-1 font-medium text-ink">Copie agora: a chave não aparece de novo.</p>
          <code className="block break-all font-mono">{created}</code>
        </div>
      )}
      <ul className="divide-y divide-gray-900/[0.06]">
        {list.map((k) => (
          <li key={k.id} className="flex items-center gap-3 py-2.5 text-sm">
            <KeyRound size={14} className="text-gray-400" aria-hidden="true" />
            <span className="flex-1">
              {k.name} <code className="font-mono text-xs text-gray-500">{k.prefix}…</code>
            </span>
            <span className="label-mono">{k.role === 'viewer' ? 'leitura' : 'escrita'}</span>
            <span className="text-xs text-gray-500">{timeAgo(k.createdAt)}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Revogar"
              onClick={() => apiKeys.revoke(k.id).then(load)}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: BI, backend"
          className={inputCls}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as ApiKey['role'])}
          className={selectCls}
        >
          <option value="viewer">Leitura</option>
          <option value="editor">Escrita</option>
        </select>
        <Button variant="primary" disabled={!name} data-testid="api-key-create" onClick={() => create()}>
          Criar
        </Button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Use em <code className="font-mono">Authorization: Bearer &lt;chave&gt;</code> em qualquer rota da API
        (ver /docs).
      </p>
    </Card>
  );
}

export function IntegrationsPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Integrações — Experimenta';
  }, []);
  const canEdit = user.role !== 'viewer';
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Integrações"
        description="Leve exposições e conversões para o GA4 e o GTM, receba eventos por webhook e acesse a API com chaves da conta."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <NativeIntegrations canEdit={canEdit} />
          {user.role === 'owner' && <ApiKeys />}
        </div>
        <Webhooks canEdit={canEdit} />
      </div>
    </>
  );
}
