import {
  CRM_DEFAULT_FIELDS,
  CRM_SOURCES,
  IntegrationsSchema,
  TRACK_TOOLS,
  WEBHOOK_EVENTS,
  type CrmConfig,
  type CrmField,
  type CrmProvider,
  type CrmStatus,
  type Integrations,
  type TrackTool,
  type TrackToolName,
  type Webhook,
} from '@abtest/shared';
import {
  Copy,
  Download,
  History,
  KeyRound,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  API_URL,
  type ApiKey,
  apiKeys,
  crm,
  type CrmView,
  entities,
  type Entity,
  type Me,
  publish,
  publishedText,
  testWebhook,
  webhookDeliveries,
  type WebhookDelivery,
} from '../api';
import { DataExport } from '../components/DataExport';
import { downloadWordpressPlugin, scriptUrl, shopifyPixel, shopifyTheme } from '../platforms';
import {
  Button,
  Card,
  inputCls,
  PageHeader,
  Segmented,
  selectCls,
  Skeleton,
  timeAgo,
  useCopy,
  useLoad,
  useToast,
} from '../ui';
import { Switch } from './Flags';
import { CodeBlock } from './Install';

const EVENT_LABEL: Record<(typeof WEBHOOK_EVENTS)[number], string> = {
  conversion: 'Conversão em teste',
  survey: 'Resposta de pesquisa',
  form: 'Formulário',
  engage: 'Pop-up / pesquisa exibidos',
  identify: 'Usuário identificado',
  event: 'Evento personalizado',
  publish: 'Publicação',
  approval: 'Pedido de publicação (aprovação)',
  mention: 'Menção em comentário',
};

/** Linha de uma integração: interruptor, nome, a chamada feita no site e (opcional) a configuração. */
function Row({
  id,
  label,
  on,
  loaded,
  onToggle,
  how,
  children,
}: {
  id: string;
  label: string;
  on: boolean;
  loaded: boolean;
  onToggle(v: boolean): unknown;
  how: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3" data-testid={`integration-${id}`}>
      {loaded ? (
        <Switch on={on} onChange={onToggle} label={label} />
      ) : (
        <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <code className="block break-all font-mono text-[11px] text-gray-500">{how}</code>
        {children}
      </span>
    </li>
  );
}

/** Nomes dos eventos de Segment/Mixpanel/Amplitude (vazio = padrão da ferramenta). */
function TrackToolForm({
  name,
  value,
  canEdit,
  onSave,
}: {
  name: TrackToolName;
  value: TrackTool;
  canEdit: boolean;
  onSave(v: TrackTool): Promise<unknown>;
}) {
  const d = TRACK_TOOLS[name];
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <details className="mt-1.5 text-xs">
      <summary className="cursor-pointer text-gray-600 select-none">Configurar eventos</summary>
      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="text-gray-600">Evento de exposição</span>
          <input
            value={draft.exposureEvent}
            onChange={(e) => setDraft({ ...draft, exposureEvent: e.target.value })}
            placeholder={d.exposure}
            maxLength={80}
            disabled={!canEdit}
            className={`${inputCls} mt-1 font-mono text-xs`}
            data-testid={`${name}-exposure`}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.conversions}
            onChange={(e) => setDraft({ ...draft, conversions: e.target.checked })}
            disabled={!canEdit}
            className="accent-[#12825f]"
          />
          Enviar também as conversões das metas
        </label>
        {draft.conversions && (
          <label className="block">
            <span className="text-gray-600">Evento de conversão</span>
            <input
              value={draft.conversionEvent}
              onChange={(e) => setDraft({ ...draft, conversionEvent: e.target.value })}
              placeholder={d.conversion}
              maxLength={80}
              disabled={!canEdit}
              className={`${inputCls} mt-1 font-mono text-xs`}
            />
          </label>
        )}
        <p className="text-gray-500">
          Propriedades: <code className="font-mono">{d.keys[0]}</code>,{' '}
          <code className="font-mono">{d.keys[1]}</code>
          {draft.conversions && (
            <>
              {' '}
              e, na conversão, <code className="font-mono">{d.keys[2]}</code> e{' '}
              <code className="font-mono">value</code>
            </>
          )}
          .
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => onSave(draft)} data-testid={`${name}-save`}>
            Salvar e publicar
          </Button>
        )}
      </div>
    </details>
  );
}

function NativeIntegrations({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data: list, setData } = useLoad(
    () => entities.list<Integrations>('integrations').catch((): Entity<Integrations>[] => []),
    [],
  );
  const e = list?.[0];
  // Entidade antiga (só ga4/gtm) ganha os padrões das ferramentas novas.
  const data = IntegrationsSchema.parse(e?.data ?? {});
  const set = async (p: Partial<Integrations>) => {
    if (!canEdit) return;
    try {
      const next = { ...data, ...p };
      const { id } = await entities.save('integrations', { id: e?.id, name: 'integrações', data: next });
      setData([{ ...(e ?? ({} as Entity<Integrations>)), id, name: 'integrações', data: next }]);
      toast(
        'success',
        publishedText(await publish(), 'Publicado: o snippet passa a enviar na próxima visita.'),
      );
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Card title="Analytics no navegador">
      <ul className="space-y-3">
        <Row
          id="ga4"
          label="Google Analytics 4"
          on={data.ga4}
          loaded={!!list}
          onToggle={(v) => set({ ga4: v })}
          how="gtag('event', 'experiment_impression', { experiment_id, variant_id })"
        />
        <Row
          id="gtm"
          label="Google Tag Manager"
          on={data.gtm}
          loaded={!!list}
          onToggle={(v) => set({ gtm: v })}
          how="dataLayer.push({ event: 'abt_exposure' | 'abt_conversion', abt_experiment, … })"
        />
        <Row
          id="gtm-events"
          label="Eventos do GTM (dataLayer)"
          on={data.gtmEvents}
          loaded={!!list}
          onToggle={(v) => set({ gtmEvents: v })}
          how="dataLayer.push({ event: 'lead', … }) vira evento: metas, funis, segmentos e filtros"
        />
        <Row
          id="gtm-user-id"
          label="user_id do site como identificação"
          on={data.gtmUserId}
          loaded={!!list}
          onToggle={(v) => set({ gtmUserId: v })}
          how="dataLayer/gtag com user_id junta os dispositivos no mesmo perfil, sem abq.push(['identify'])"
        />
        {(Object.keys(TRACK_TOOLS) as TrackToolName[]).map((k) => {
          const d = TRACK_TOOLS[k];
          const t = data[k];
          return (
            <Row
              key={k}
              id={k}
              label={d.label}
              on={t.enabled}
              loaded={!!list}
              onToggle={(v) => set({ [k]: { ...t, enabled: v } })}
              how={`${d.global}.track('${t.exposureEvent || d.exposure}', { ${d.keys[0]}, ${d.keys[1]} })`}
            >
              {t.enabled && (
                <TrackToolForm name={k} value={t} canEdit={canEdit} onSave={(v) => set({ [k]: v })} />
              )}
            </Row>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        Usa a ferramenta que já está no seu site (nada é carregado por nós). Eventos de QA nunca saem.
      </p>
    </Card>
  );
}

/** Shopify (tema + pixel do checkout) e WordPress (plugin baixável). */
function Platforms({ user }: { user: Me }) {
  const toast = useToast();
  const [tab, setTab] = useState<'shopify' | 'wordpress'>('shopify');
  const url = scriptUrl(API_URL, user.accountId);
  const download = async () => {
    try {
      await downloadWordpressPlugin(url);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Card
      title="Plataformas"
      action={
        <Segmented
          label="Plataforma"
          value={tab}
          onChange={setTab}
          options={[
            ['shopify', 'Shopify'],
            ['wordpress', 'WordPress'],
          ]}
        />
      }
    >
      {tab === 'shopify' ? (
        <div className="space-y-4 text-sm text-gray-600" data-testid="shopify">
          <div>
            <p className="mb-2">
              <b className="text-ink">1. Tema:</b> Loja virtual → Temas → Editar código →{' '}
              <code className="font-mono text-xs">layout/theme.liquid</code>, logo depois de{' '}
              <code className="font-mono text-xs">&lt;head&gt;</code>. Identifica o cliente logado (e-mail no
              perfil, usado pelos CRMs) e o produto visto.
            </p>
            <CodeBlock code={shopifyTheme(API_URL, user.accountId)} testId="shopify-theme" />
          </div>
          <div>
            <p className="mb-2">
              <b className="text-ink">2. Compras:</b> Configurações → Eventos do cliente → Adicionar pixel
              personalizado (permissão: análise). O checkout não roda o tema: o pixel manda a compra como
              evento <code className="font-mono text-xs">purchase</code> com o valor e como conversão das
              metas &quot;evento customizado <code className="font-mono text-xs">purchase</code>&quot;.
            </p>
            <CodeBlock code={shopifyPixel(API_URL, user.accountId)} testId="shopify-pixel" />
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-gray-600" data-testid="wordpress">
          <p>
            Plugin de um arquivo, sem dependências: coloca o snippet no início do{' '}
            <code className="font-mono text-xs">&lt;head&gt;</code>, identifica usuários logados (opcional) e
            manda as compras do WooCommerce como <code className="font-mono text-xs">purchase</code>.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Baixe o plugin (já vem com o script desta conta).</li>
            <li>WordPress → Plugins → Adicionar novo → Enviar plugin → escolha o .zip e ative.</li>
            <li>Configurações → Experimenta: confira a URL e a posição no &lt;head&gt;.</li>
          </ol>
          <Button variant="primary" size="sm" onClick={() => download()} data-testid="wordpress-download">
            <Download size={14} aria-hidden="true" /> Baixar plugin (.zip)
          </Button>
          <p className="text-xs text-gray-500">
            URL do script: <code className="break-all font-mono">{url}</code>
          </p>
        </div>
      )}
    </Card>
  );
}

const CRM_LABEL: Record<CrmProvider, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce' };

/** Mapa perfil do CDP → campos do CRM. */
function FieldMap({
  fields,
  provider,
  disabled,
  onChange,
}: {
  fields: CrmField[];
  provider: CrmProvider;
  disabled: boolean;
  onChange(f: CrmField[]): void;
}) {
  const set = (i: number, f: CrmField) => onChange(fields.map((x, j) => (j === i ? f : x)));
  return (
    <div className="space-y-1.5" data-testid={`${provider}-fields`}>
      {fields.map((f, i) => {
        const attr = f.from.startsWith('attr.');
        return (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={attr ? 'attr' : f.from}
              onChange={(e) => set(i, { ...f, from: e.target.value === 'attr' ? 'attr.' : e.target.value })}
              disabled={disabled}
              aria-label="Dado do perfil"
              className={`${selectCls} min-w-0 flex-1 text-xs`}
            >
              {Object.entries(CRM_SOURCES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
              <option value="attr">Atributo do site…</option>
            </select>
            {attr && (
              <input
                value={f.from.slice(5)}
                onChange={(e) => set(i, { ...f, from: `attr.${e.target.value}` })}
                placeholder="plano"
                aria-label="Nome do atributo"
                disabled={disabled}
                className={`${inputCls} w-24 font-mono text-xs`}
              />
            )}
            <span className="text-gray-400" aria-hidden="true">
              →
            </span>
            <input
              value={f.to}
              onChange={(e) => set(i, { ...f, to: e.target.value })}
              aria-label="Campo no CRM"
              disabled={disabled}
              className={`${inputCls} min-w-0 flex-1 font-mono text-xs`}
            />
            {!disabled && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remover campo"
                onClick={() => onChange(fields.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        );
      })}
      {!disabled && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={fields.length >= 30}
            onClick={() => onChange([...fields, { from: 'sessions', to: '' }])}
          >
            <Plus size={13} aria-hidden="true" /> Campo
          </Button>
          {!fields.length && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(CRM_DEFAULT_FIELDS[provider])}
              data-testid={`${provider}-defaults`}
            >
              Usar sugeridos
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CrmStatusLine({ s }: { s: CrmStatus | null }) {
  if (!s?.at) return <p className="text-xs text-gray-500">Ainda não sincronizado.</p>;
  return (
    <div className="text-xs" data-testid="crm-status" role="status">
      <p className={s.ok ? 'text-gray-600' : 'text-red-700'}>
        {s.ok ? 'Última sincronização' : 'Última sincronização com erro'} {timeAgo(s.at)}: {s.sent} perfis
        enviados{s.failed ? `, ${s.failed} recusados` : ''}
        {s.remaining ? `, ${s.remaining} pendentes` : ''} · {s.total} desde a última mudança na configuração.
      </p>
      {s.errors.map((e) => (
        <p key={e} className="mt-0.5 font-mono text-[11px] break-words text-red-700">
          {e}
        </p>
      ))}
    </div>
  );
}

function CrmPanel({
  provider,
  view,
  role,
  onView,
}: {
  provider: CrmProvider;
  view: CrmView;
  role: Me['role'];
  onView(v: CrmView): void;
}) {
  const toast = useToast();
  const isOwner = role === 'owner';
  const [hs, setHs] = useState(view.config.hubspot);
  const [sf, setSf] = useState(view.config.salesforce);
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState(view.status[provider]);
  useEffect(() => {
    setHs(view.config.hubspot);
    setSf(view.config.salesforce);
    setStatus(view.status[provider]);
    setSecret('');
  }, [view, provider]);
  const cur = provider === 'hubspot' ? hs : sf;
  const setCur = (p: Partial<typeof cur>) =>
    provider === 'hubspot' ? setHs({ ...hs, ...p }) : setSf({ ...sf, ...p });
  const save = async () => {
    try {
      // Só o CRM desta aba muda; o outro vai como está (sem segredo: a API mantém o guardado).
      const config: CrmConfig = {
        hubspot:
          provider === 'hubspot' ? { ...hs, ...(secret ? { token: secret } : {}) } : view.config.hubspot,
        salesforce:
          provider === 'salesforce'
            ? { ...sf, ...(secret ? { clientSecret: secret } : {}) }
            : view.config.salesforce,
      };
      onView(await crm.save(config));
      toast('success', `${CRM_LABEL[provider]} salvo.`);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const sync = async () => {
    try {
      // Um lote por requisição (CPU do Worker); continua enquanto houver pendentes.
      for (let i = 0; i < 50; i++) {
        const s = await crm.sync(provider);
        setStatus(s);
        if (!s.ok || !s.remaining || !s.sent) break;
      }
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra: InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="block text-xs">
      <span className="text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!isOwner}
        className={`${inputCls} mt-1 text-xs`}
        {...extra}
      />
    </label>
  );
  return (
    <div className="space-y-3" data-testid={`crm-${provider}`}>
      <div className="flex items-center gap-3">
        <Switch
          on={cur.enabled}
          onChange={(v) => isOwner && setCur({ enabled: v })}
          label={`Ligar ${CRM_LABEL[provider]}`}
        />
        <span className="text-sm text-gray-600">
          {view.config[provider].enabled ? 'Ligado: sincroniza de hora em hora' : 'Desligado'}
          {cur.enabled !== view.config[provider].enabled && ' (salve para valer)'}
        </span>
      </div>
      {provider === 'hubspot' ? (
        <>
          {field('Token do app privado (escopo crm.objects.contacts.write)', secret, setSecret, {
            type: 'password',
            autoComplete: 'off',
            placeholder: view.hasHubspotToken ? '•••••• guardado (deixe vazio para manter)' : 'pat-na1-…',
            'aria-label': 'Token do HubSpot',
          })}
          <p className="text-xs text-gray-500">
            Contatos criados ou atualizados pelo e-mail. Crie no HubSpot as propriedades do mapa abaixo antes
            de ligar.
          </p>
        </>
      ) : (
        <>
          {field('Domínio da org', sf.instanceUrl, (v) => setSf({ ...sf, instanceUrl: v }), {
            placeholder: 'https://empresa.my.salesforce.com',
            'aria-label': 'Domínio da org Salesforce',
          })}
          <div className="grid gap-2 sm:grid-cols-2">
            {field('Client id (app conectado)', sf.clientId, (v) => setSf({ ...sf, clientId: v }))}
            {field('Client secret', secret, setSecret, {
              type: 'password',
              autoComplete: 'off',
              placeholder: view.hasSalesforceSecret ? '•••••• guardado' : '',
              'aria-label': 'Client secret do Salesforce',
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="text-gray-600">Objeto</span>
              <select
                value={sf.object}
                onChange={(e) => setSf({ ...sf, object: e.target.value as typeof sf.object })}
                disabled={!isOwner}
                className={`${selectCls} mt-1 w-full text-xs`}
              >
                <option value="Contact">Contato (Contact)</option>
                <option value="Lead">Lead</option>
              </select>
            </label>
            {field(
              'Campo de ID externo (e-mail)',
              sf.externalIdField,
              (v) => setSf({ ...sf, externalIdField: v }),
              { placeholder: 'Email_Externo__c' },
            )}
          </div>
          <p className="text-xs text-gray-500">
            App conectado com o fluxo <i>client credentials</i>. Upsert pelo campo de ID externo (único) com o
            e-mail; registros novos precisam dos campos obrigatórios do objeto (ex.: LastName) no mapa abaixo.
          </p>
        </>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-ink">Campos (perfil do CDP → {CRM_LABEL[provider]})</p>
        <FieldMap
          provider={provider}
          fields={cur.fields}
          disabled={!isOwner}
          onChange={(fields) => setCur({ fields })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isOwner && (
          <Button variant="primary" size="sm" onClick={() => save()} data-testid={`crm-${provider}-save`}>
            Salvar
          </Button>
        )}
        {role !== 'viewer' && view.config[provider].enabled && (
          <Button size="sm" onClick={() => sync()} data-testid={`crm-${provider}-sync`}>
            <RefreshCw size={13} aria-hidden="true" /> Sincronizar agora
          </Button>
        )}
      </div>
      <CrmStatusLine s={status} />
    </div>
  );
}

/** HubSpot e Salesforce: perfis do CDP com e-mail, de hora em hora ou no botão. */
function Crm({ user }: { user: Me }) {
  const { data, setData } = useLoad(() => crm.get(), []);
  const [tab, setTab] = useState<CrmProvider>('hubspot');
  return (
    <Card
      title="CRM (atributos do CDP)"
      action={
        <Segmented
          label="CRM"
          value={tab}
          onChange={setTab}
          options={[
            ['hubspot', 'HubSpot'],
            ['salesforce', 'Salesforce'],
          ]}
        />
      }
    >
      {data ? (
        <CrmPanel provider={tab} view={data} role={user.role} onView={setData} />
      ) : (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Vão os perfis com e-mail (atributo <code className="font-mono">email</code> ou usuário identificado
        por e-mail) que mudaram desde a última sincronização, com os números dos últimos 30 dias. Token e
        segredo só são gravados: nunca voltam para a tela.
      </p>
    </Card>
  );
}

const DELIVERY_LABEL: Record<WebhookDelivery['status'], [string, string]> = {
  pending: ['Na fila', 'bg-amber-50 text-amber-800'],
  delivered: ['Entregue no reenvio', 'bg-brand-50 text-brand-700'],
  failed: ['Falhou', 'bg-red-50 text-red-700'],
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Entregas que falharam ao menos uma vez (as certas de primeira não ficam guardadas). */
function Deliveries({ hookId, canEdit }: { hookId: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, reload } = useLoad(() => webhookDeliveries.list(hookId), [hookId]);
  const retry = async (d: WebhookDelivery) => {
    try {
      const r = await webhookDeliveries.retry(hookId, d.id);
      toast(
        r.status === 'delivered' ? 'success' : 'error',
        r.status === 'delivered' ? 'Entregue.' : `Falhou de novo: ${r.lastError ?? 'erro'}.`,
      );
    } catch (err) {
      toast('error', (err as Error).message);
    }
    reload();
  };
  if (!data)
    return (
      <div className="mt-2 space-y-1.5" aria-hidden="true">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  return (
    <div className="mt-2 rounded-md bg-gray-50 p-2.5 text-xs" data-testid="webhook-deliveries">
      <p className="text-gray-600">
        {data.pending} na fila · {data.failed} com falha. Entregas certas de primeira não aparecem aqui.
      </p>
      {data.deliveries.length === 0 ? (
        <p className="mt-1 text-gray-500">Nenhuma falha recente.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-gray-900/[0.06]">
          {data.deliveries.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
              <span className={`rounded px-1.5 py-0.5 font-medium ${DELIVERY_LABEL[d.status][1]}`}>
                {DELIVERY_LABEL[d.status][0]}
              </span>
              <span className="font-mono text-gray-700">{d.type}</span>
              <span className="text-gray-500" title={when(d.createdAt)}>
                {timeAgo(d.createdAt)}
              </span>
              <span className="text-gray-600">
                tentativa {d.attempts} de {data.maxAttempts}
              </span>
              {d.status !== 'delivered' && d.lastError && (
                <span className="break-all text-red-700">{d.lastError}</span>
              )}
              {d.status === 'pending' && d.nextAt && (
                <span className="text-gray-600">próxima {when(d.nextAt)}</span>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => retry(d)}
                  data-testid="webhook-retry"
                >
                  <RefreshCw size={12} aria-hidden="true" /> Reenviar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Webhooks({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const copy = useCopy();
  const { data: list, reload } = useLoad(
    () => entities.list<Webhook>('webhook').catch((): Entity<Webhook>[] => []),
    [],
  );
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Webhook['events']>(['conversion']);
  const [open, setOpen] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => p.then(reload, (err: Error) => toast('error', err.message));
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
        {!list &&
          [0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3 py-2.5" aria-hidden="true">
              <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </span>
            </li>
          ))}
        {list?.map((h) => (
          <li key={h.id} className="py-2.5">
            <div className="flex items-center gap-3">
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
              <Button
                size="sm"
                variant="ghost"
                aria-label="Entregas"
                aria-expanded={open === h.id}
                title="Entregas com falha e reenvios"
                onClick={() => setOpen(open === h.id ? null : h.id)}
                data-testid="webhook-deliveries-toggle"
              >
                <History size={14} />
              </Button>
            </div>
            {open === h.id && <Deliveries hookId={h.id} canEdit={canEdit} />}
          </li>
        ))}
        {list?.length === 0 && (
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
        POST JSON com <code className="font-mono">X-Abt-Signature: sha256=HMAC(segredo, corpo)</code>,{' '}
        <code className="font-mono">X-Abt-Delivery</code> (mesmo id em todas as tentativas: use para não
        processar duas vezes) e <code className="font-mono">X-Abt-Attempt</code>. Sem resposta, 5xx, 408 ou
        429: tenta de novo em 1 min, 6 min, 36 min, 3,6 h e 21,6 h; outro 4xx não reenvia.
      </p>
    </Card>
  );
}

function ApiKeys() {
  const toast = useToast();
  const { data: list, reload } = useLoad(() => apiKeys.list().catch((): ApiKey[] => []), []);
  const [name, setName] = useState('');
  const [role, setRole] = useState<ApiKey['role']>('viewer');
  const [created, setCreated] = useState<string | null>(null);
  const create = async () => {
    try {
      setCreated((await apiKeys.create(name, role)).key);
      setName('');
      reload();
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
        {!list &&
          [0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3 py-2.5" aria-hidden="true">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="ml-auto h-3.5 w-16" />
            </li>
          ))}
        {list?.map((k) => (
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
              onClick={() => apiKeys.revoke(k.id).then(reload)}
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
    document.title = 'Integrações · Experimenta';
  }, []);
  const canEdit = user.role !== 'viewer';
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Integrações"
        description="Leve exposições e conversões para GA4, GTM, Segment, Mixpanel e Amplitude, instale no Shopify e no WordPress, sincronize perfis com HubSpot e Salesforce, receba eventos por webhook, exporte dados para CSV, S3 ou BigQuery e acesse a API com chaves da conta."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <NativeIntegrations canEdit={canEdit} />
          <Platforms user={user} />
          {user.role === 'owner' && <ApiKeys />}
        </div>
        <div className="space-y-5">
          <Crm user={user} />
          <Webhooks canEdit={canEdit} />
          <DataExport user={user} />
        </div>
      </div>
    </>
  );
}
