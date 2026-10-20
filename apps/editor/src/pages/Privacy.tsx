import { ConsentSchema, type Consent } from '@abtest/shared';
import { useEffect, useState } from 'react';
import { entities, type Entity, type Me, publish, publishedText } from '../api';
import { Button, Card, inputCls, PageHeader, selectCls, Skeleton, useLoad, useToast } from '../ui';
import { Switch } from './Flags';
import { CodeBlock } from './Install';

const CMPS: Record<Consent['cmp'], { label: string; category: string; hint: string }> = {
  none: {
    label: 'Nenhum: o site avisa pelo código',
    category: '',
    hint: "O site chama abq.push(['consent', true]) quando o visitante aceitar.",
  },
  onetrust: { label: 'OneTrust', category: 'C0002', hint: 'Id do grupo de cookies (C0002 = desempenho).' },
  cookiebot: { label: 'Cookiebot', category: 'statistics', hint: 'statistics, marketing ou preferences.' },
  gcm: {
    label: 'Google Consent Mode v2',
    category: 'analytics_storage',
    hint: 'Tipo de armazenamento do gtag (analytics_storage ou ad_storage). "default" negado espera o "update" do banner.',
  },
};

const DEFAULT: Consent = { required: false, cmp: 'none', category: '' };

function ConsentCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data: list, setData } = useLoad(
    () => entities.list<Consent>('consent').catch((): Entity<Consent>[] => []),
    [],
  );
  const saved = list?.[0];
  const [form, setForm] = useState<Consent>(DEFAULT);
  useEffect(() => setForm(saved?.data ?? DEFAULT), [saved]);
  const set = (p: Partial<Consent>) => setForm((f) => ({ ...f, ...p }));
  const cmp = CMPS[form.cmp];

  const save = async () => {
    const parsed = ConsentSchema.safeParse(form);
    if (!parsed.success) return toast('error', parsed.error.issues[0]!.message);
    try {
      const { id } = await entities.save('consent', {
        id: saved?.id,
        name: 'consentimento',
        data: parsed.data,
      });
      setData([{ ...(saved ?? ({} as Entity<Consent>)), id, name: 'consentimento', data: parsed.data }]);
      toast('success', publishedText(await publish(), 'Publicado: vale a partir da próxima página vista.'));
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  if (!list)
    return (
      <Card title="Consentimento (LGPD/GDPR)">
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </Card>
    );
  return (
    <Card title="Consentimento (LGPD/GDPR)">
      <div className="flex items-start gap-3">
        <Switch
          on={form.required}
          onChange={(required) => canEdit && set({ required })}
          label="Esperar consentimento"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Esperar consentimento</span>
          <span className="block text-xs text-gray-500">
            Até o visitante aceitar, o snippet não grava cookies, não aplica testes, não mostra pop-ups e não
            coleta nada (nem mapa de calor, gravação ou formulários). Desligado, roda direto e o visitante
            ainda pode recusar.
          </span>
        </span>
      </div>
      {form.required && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-600">
            Banner de cookies (CMP)
            <select
              value={form.cmp}
              disabled={!canEdit}
              onChange={(e) => set({ cmp: e.target.value as Consent['cmp'], category: '' })}
              className={`${selectCls} mt-1 w-full`}
              data-testid="consent-cmp"
            >
              {Object.entries(CMPS).map(([k, c]) => (
                <option key={k} value={k}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {form.cmp !== 'none' && (
            <label className="block text-xs font-medium text-gray-600">
              Categoria exigida
              <input
                value={form.category}
                disabled={!canEdit}
                onChange={(e) => set({ category: e.target.value })}
                placeholder={cmp.category}
                className={`${inputCls} mt-1 font-mono text-xs`}
                data-testid="consent-category"
              />
            </label>
          )}
          <p className="text-xs text-gray-500 sm:col-span-2">{cmp.hint}</p>
        </div>
      )}
      {canEdit && (
        <Button variant="primary" size="sm" className="mt-4" onClick={save} data-testid="consent-save">
          Salvar e publicar
        </Button>
      )}
    </Card>
  );
}

const SITE_CODE = `window.abq = window.abq || [];
abq.push(['consent', true]);  // aceitou
abq.push(['consent', false]); // recusou: apaga os cookies do snippet`;

export function PrivacyPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Privacidade · Experimenta';
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Privacidade"
        description="Consentimento de cookies (LGPD/GDPR) e saída do visitante. A decisão de cada visitante fica no cookie _abt_c do próprio site."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ConsentCard canEdit={user.role !== 'viewer'} />
        <Card title="No site">
          <p className="text-sm text-gray-600">
            Com qualquer banner, avise o snippet quando o visitante decidir (pode ser antes de ele carregar):
          </p>
          <div className="mt-3">
            <CodeBlock code={SITE_CODE} />
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Link de saída para a política de privacidade (vale mesmo sem esperar consentimento):
          </p>
          <code className="mt-1 block font-mono text-xs break-all text-ink">
            https://seu-site.com/privacidade?abt_optout=1
          </code>
        </Card>
      </div>
    </>
  );
}
