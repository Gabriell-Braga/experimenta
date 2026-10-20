import { Copy, Download, LogOut, MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  securityApi,
  signOut,
  switchAccount,
  type LoginSession,
  type Me,
  type SsoConfig,
} from '../api';
import {
  Button,
  Card,
  inputCls,
  Logo,
  PageHeader,
  selectCls,
  Skeleton,
  timeAgo,
  useCopy,
  useLoad,
  useToast,
} from '../ui';
import { Switch } from './Flags';

/** "Chrome · Windows" a partir do user-agent (só para reconhecer a sessão na lista). */
export function device(ua: string): string {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Navegador';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

const codeInput = (name: string, label: string) => (
  <input
    name={name}
    required
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={40}
    placeholder="123456"
    aria-label={label}
    className={`${inputCls} w-36 font-mono tracking-widest`}
  />
);

/** Códigos de recuperação recém-gerados: aparecem uma vez só. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone(): void }) {
  const copy = useCopy();
  const text = codes.join('\n');
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Códigos de recuperação (Experimenta)\n\n${text}\n`]));
    a.download = 'codigos-de-recuperacao.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="recovery-codes">
      <p className="text-sm font-medium text-ink">Guarde estes códigos de recuperação</p>
      <p className="mt-1 text-xs text-gray-600">
        Cada um entra uma vez se você perder o celular. Eles não aparecem de novo.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm text-ink">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy(text, 'Códigos copiados.')}>
          <Copy size={12} aria-hidden="true" /> Copiar
        </Button>
        <Button size="sm" onClick={download}>
          <Download size={12} aria-hidden="true" /> Baixar .txt
        </Button>
        <Button size="sm" variant="primary" onClick={onDone} data-testid="recovery-done">
          Já guardei
        </Button>
      </div>
    </div>
  );
}

/** Login em duas etapas da pessoa: configurar (segredo + URI), ativar, novos códigos, desativar. */
export function TotpCard({ onChange }: { onChange?(): void }) {
  const toast = useToast();
  const copy = useCopy();
  const { data: st, reload } = useLoad(() => securityApi.totp(), []);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'codes' | 'disable' | null>(null);
  const fail = (err: unknown) => toast('error', (err as Error).message);
  const busy = useRef(false);

  const start = async () => {
    try {
      setSetup(await securityApi.setup());
    } catch (err) {
      fail(err);
    }
  };
  const submit = (fn: (f: FormData) => Promise<void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return; // Enter + clique: um envio só
    busy.current = true;
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      fail(err);
    } finally {
      busy.current = false;
    }
  };

  if (!st)
    return (
      <Card title="Login em duas etapas">
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </Card>
    );
  return (
    <Card
      title="Login em duas etapas"
      action={
        <span className={`label-mono ${st.enabled ? 'text-brand-700' : ''}`} data-testid="totp-status">
          {st.enabled ? 'ativado' : 'desativado'}
        </span>
      }
    >
      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            reload();
            onChange?.();
          }}
        />
      ) : st.enabled ? (
        <>
          <p className="text-sm text-gray-600">
            Ao entrar, além da senha, pedimos o código de 6 dígitos do app autenticador.{' '}
            <b className="text-ink">{st.recoveryCodesLeft}</b> códigos de recuperação restantes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMode(mode === 'codes' ? null : 'codes')}>
              Gerar novos códigos de recuperação
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={st.required}
              title={st.required ? 'Esta conta exige login em duas etapas' : undefined}
              onClick={() => setMode(mode === 'disable' ? null : 'disable')}
            >
              Desativar
            </Button>
          </div>
          {mode === 'codes' && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={submit(async (f) => {
                setCodes((await securityApi.recoveryCodes(String(f.get('code')))).recoveryCodes);
                setMode(null);
              })}
            >
              {codeInput('code', 'Código do app')}
              <Button type="submit" size="sm" variant="primary">
                Gerar
              </Button>
            </form>
          )}
          {mode === 'disable' && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={submit(async (f) => {
                await securityApi.disable(String(f.get('password')), String(f.get('code')));
                setMode(null);
                toast('success', 'Login em duas etapas desativado.');
                reload();
                onChange?.();
              })}
            >
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Sua senha"
                aria-label="Sua senha"
                className={`${inputCls} w-44`}
              />
              {codeInput('code', 'Código do app ou de recuperação')}
              <Button type="submit" size="sm" variant="danger">
                Desativar
              </Button>
            </form>
          )}
          {st.required && (
            <p className="mt-3 text-xs text-gray-500">Esta conta exige login em duas etapas de todos.</p>
          )}
        </>
      ) : setup ? (
        <form
          onSubmit={submit(async (f) => {
            setCodes((await securityApi.enable(String(f.get('code')))).recoveryCodes);
            setSetup(null);
          })}
        >
          <ol className="list-decimal space-y-3 pl-5 text-sm text-gray-700">
            <li>
              No app autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), adicione
              uma conta com esta chave:
              <span className="mt-1 flex items-center gap-2">
                <code
                  className="font-mono text-sm tracking-wider break-all text-ink"
                  data-testid="totp-secret"
                >
                  {setup.secret.match(/.{1,4}/g)!.join(' ')}
                </code>
                <Button size="sm" type="button" onClick={() => copy(setup.secret, 'Chave copiada.')}>
                  <Copy size={12} aria-hidden="true" /> Copiar
                </Button>
              </span>
              <span className="mt-1 block text-xs text-gray-500">
                Ou abra este link no celular (apps de senha leem direto):{' '}
                <a href={setup.uri} className="break-all text-brand-700 underline">
                  {setup.uri}
                </a>
              </span>
            </li>
            <li>
              Digite o código de 6 dígitos que o app mostra:
              <span className="mt-1 flex flex-wrap items-end gap-2">
                {codeInput('code', 'Código de 6 dígitos')}
                <Button type="submit" variant="primary" data-testid="totp-enable">
                  Ativar
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                  Cancelar
                </Button>
              </span>
            </li>
          </ol>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Proteja o acesso com um código do celular além da senha. Funciona com qualquer app autenticador
            (TOTP).
          </p>
          {st.required && (
            <p className="mt-2 text-sm font-medium text-amber-800">Esta conta exige: ative para continuar.</p>
          )}
          <Button className="mt-4" variant="primary" onClick={start} data-testid="totp-setup">
            Configurar
          </Button>
        </>
      )}
    </Card>
  );
}

function SessionsCard() {
  const toast = useToast();
  const { data: list, reload } = useLoad(() => securityApi.sessions(), []);
  const revoke = async (s: LoginSession) => {
    try {
      await securityApi.revoke(s.id);
      reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const others = list?.filter((s) => !s.current).length ?? 0;
  return (
    <Card
      title="Sessões ativas"
      pad={false}
      action={
        <Button
          size="sm"
          disabled={!others}
          onClick={async () => {
            if (!confirm('Sair de todos os outros lugares? Só esta sessão continua aberta.')) return;
            try {
              const { revoked } = await securityApi.revokeOthers();
              toast('success', `${revoked} ${revoked === 1 ? 'sessão encerrada' : 'sessões encerradas'}.`);
              reload();
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
          data-testid="sessions-revoke-all"
        >
          <LogOut size={12} aria-hidden="true" /> Sair de todos os outros
        </Button>
      }
    >
      <ul className="divide-y divide-gray-900/[0.06]" data-testid="sessions">
        {!list &&
          [0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="ml-auto h-3.5 w-16" />
            </li>
          ))}
        {list?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid="session">
            <MonitorSmartphone size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">
                {device(s.userAgent)}{' '}
                {s.current && <span className="text-xs font-normal text-brand-700">(esta sessão)</span>}
              </span>
              <span className="block truncate text-xs text-gray-500">
                {[s.ip, s.accountName, `entrou ${timeAgo(s.createdAt)}`, `ativa ${timeAgo(s.lastSeenAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={() => revoke(s)} aria-label="Encerrar sessão">
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Owner: exigir duas etapas de toda a equipe. */
function AccountTotpCard({ me }: { me: Me }) {
  const toast = useToast();
  const { data, setData } = useLoad(() => securityApi.account(), []);
  return (
    <Card title="Exigir duas etapas na conta">
      <div className="flex items-start gap-3">
        <Switch
          on={!!data?.requireTotp}
          label="Exigir login em duas etapas de todos"
          onChange={async (on) => {
            try {
              await securityApi.setRequireTotp(on);
              setData((d) => d && { ...d, requireTotp: on });
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
        />
        <span>
          <span className="block text-sm font-medium text-ink">Exigir de todos os membros</span>
          <span className="block text-xs text-gray-500">
            Quem ainda não ativou só consegue usar esta tela até ativar. Chaves de API não são afetadas.
            {!me.totpEnabled && ' Ative o seu antes.'}
          </span>
        </span>
      </div>
      {!!data?.withoutTotp.length && (
        <div className="mt-4">
          <p className="label-mono">Sem duas etapas ({data.withoutTotp.length})</p>
          <ul className="mt-1 text-sm text-gray-700" data-testid="without-totp">
            {data.withoutTotp.map((m) => (
              <li key={m.id} className="truncate">
                {m.name} <span className="text-xs text-gray-500">{m.email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const EMPTY_SSO: SsoConfig = { enabled: false, protocol: 'oidc', domains: [] };

/** Owner: configuração de SSO (base; o login por SSO depende do protocolo estar disponível na instalação). */
function SsoCard() {
  const toast = useToast();
  const { data } = useLoad(() => securityApi.sso(), []);
  const [form, setForm] = useState<SsoConfig>(EMPTY_SSO);
  const [domains, setDomains] = useState('');
  useEffect(() => {
    if (!data) return;
    setForm({ ...EMPTY_SSO, ...data.config, clientSecret: '' });
    setDomains(data.config?.domains.join(', ') ?? '');
  }, [data]);
  const set = (p: Partial<SsoConfig>) => setForm((f) => ({ ...f, ...p }));
  const available = !!data?.available.includes(form.protocol);
  const field = (key: keyof SsoConfig, label: string, props: Record<string, unknown> = {}) => (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input
        value={String(form[key] ?? '')}
        onChange={(e) => set({ [key]: e.target.value })}
        className={`${inputCls} mt-1 text-xs`}
        {...props}
      />
    </label>
  );
  const save = async () => {
    const clean = (v?: string) => v?.trim() || undefined;
    try {
      await securityApi.saveSso({
        ...form,
        domains: domains
          .split(/[\s,;]+/)
          .map((d) => d.trim())
          .filter(Boolean),
        issuer: clean(form.issuer),
        clientId: clean(form.clientId),
        clientSecret: clean(form.clientSecret),
        ssoUrl: clean(form.ssoUrl),
        idpEntityId: clean(form.idpEntityId),
        idpCert: clean(form.idpCert),
      });
      toast('success', 'Configuração de SSO salva.');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  if (!data)
    return (
      <Card title="SSO (SAML / OIDC)">
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  return (
    <Card title="SSO (SAML / OIDC)">
      <p className="text-sm text-gray-600">
        Login pelo provedor de identidade da empresa (Okta, Entra ID, Google Workspace…).{' '}
        {available
          ? 'Disponível nesta instalação.'
          : 'Ainda não disponível nesta instalação: a configuração pode ser salva e ligada quando o protocolo estiver pronto.'}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-600">
          Protocolo
          <select
            value={form.protocol}
            onChange={(e) => set({ protocol: e.target.value as SsoConfig['protocol'], enabled: false })}
            className={`${selectCls} mt-1 w-full`}
            data-testid="sso-protocol"
          >
            <option value="oidc">OpenID Connect (OIDC)</option>
            <option value="saml">SAML 2.0</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Domínios de e-mail
          <input
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="empresa.com.br"
            className={`${inputCls} mt-1 text-xs`}
          />
        </label>
        {form.protocol === 'oidc' ? (
          <>
            {field('issuer', 'Emissor (issuer)', { placeholder: 'https://login.empresa.com', type: 'url' })}
            {field('clientId', 'Client ID')}
            {field(
              'clientSecret',
              data.hasClientSecret ? 'Client secret (salvo; vazio mantém)' : 'Client secret',
              {
                type: 'password',
                autoComplete: 'off',
              },
            )}
          </>
        ) : (
          <>
            {field('ssoUrl', 'URL de login do IdP', { type: 'url' })}
            {field('idpEntityId', 'Entity ID do IdP')}
            <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
              Certificado do IdP (PEM)
              <textarea
                value={form.idpCert ?? ''}
                onChange={(e) => set({ idpCert: e.target.value })}
                rows={3}
                className={`${inputCls} mt-1 font-mono text-xs`}
              />
            </label>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-gray-700">
          <Switch
            on={form.enabled}
            label="Ligar SSO"
            onChange={(enabled) => (available || !enabled ? set({ enabled }) : undefined)}
          />
          Ligado
        </span>
        <Button size="sm" variant="primary" onClick={save} data-testid="sso-save">
          Salvar
        </Button>
      </div>
    </Card>
  );
}

export function SecurityPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Segurança · Experimenta';
  }, []);
  const owner = user.role === 'owner';
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Segurança"
        description="Seu login em duas etapas e onde você está conectado. Owners também definem as regras de acesso da conta."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <TotpCard />
        <SessionsCard />
        {owner && <AccountTotpCard me={user} />}
        {owner && <SsoCard />}
      </div>
    </>
  );
}

/** Conta que exige duas etapas e a pessoa ainda não ativou: só esta tela até ativar. */
export function TotpGate({ user, onDone }: { user: Me; onDone(): void }) {
  const other = user.accounts?.find((a) => a.id !== user.accountId);
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-lg" data-testid="totp-gate">
        <Logo className="mb-10" />
        <p className="label-mono">Segurança</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Ative o login em duas etapas</h1>
        <p className="mt-2 mb-6 text-sm text-gray-600">
          A conta <b>{user.accounts?.find((a) => a.id === user.accountId)?.name ?? ''}</b> exige um código do
          celular além da senha. Configure agora para continuar.
        </p>
        <TotpCard onChange={onDone} />
        <div className="mt-6 flex flex-wrap gap-2">
          {other && (
            <Button
              variant="ghost"
              onClick={() =>
                switchAccount(other.id).then(
                  () => (location.href = location.pathname),
                  (e: ApiError) => alert(e.message),
                )
              }
            >
              Ir para {other.name}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut();
              location.href = location.pathname;
            }}
          >
            <LogOut size={14} aria-hidden="true" /> Sair
          </Button>
        </div>
      </div>
    </main>
  );
}
