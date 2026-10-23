import { useState, type InputHTMLAttributes } from 'react';
import { ApiError, forgotPassword, login, loginTotp, resetPassword, signup, type Me } from '../api';
import { Button, inputCls, Logo } from '../ui';

/** Cartão de "resultado" do painel de apresentação: a cara do produto antes de entrar. */
function SampleResult() {
  const rows = [
    ['C', 'Controle', '3,12%', 'base', 'bg-white/15'],
    ['V1', 'Botão "Comprar agora"', '3,51%', '+12,4%', 'bg-lime'],
  ] as const;
  return (
    <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.12em] text-white/40 uppercase">
          checkout · conversão
        </p>
        <span className="rounded-sm bg-lime px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">
          97% de chance de vencer
        </span>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map(([tag, name, rate, lift, bar]) => (
          <li key={tag}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-white/85">
                <span className="grid h-5 min-w-5 place-items-center rounded-sm bg-white/10 px-1 font-mono text-[10px]">
                  {tag}
                </span>
                {name}
              </span>
              <span className="tabular font-mono text-xs text-white/60">
                {rate} <b className={tag === 'V1' ? 'text-lime' : 'text-white/40'}>{lift}</b>
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-white/[0.07]">
              <div className={`h-full rounded-full ${bar}`} style={{ width: tag === 'C' ? '62%' : '70%' }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Link de recuperação de senha (`?reset=<token>`). */
const resetToken = () => new URLSearchParams(location.search).get('reset');

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

/** Campo de texto do login (rótulo visível = nome acessível). */
function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input required className={inputCls} aria-label={label} {...props} />
    </label>
  );
}

function PasswordHint() {
  return (
    <p id="pw-hint" className="-mt-2 text-xs text-gray-600">
      Mínimo de 10 caracteres.
    </p>
  );
}

const errorText = (err: unknown) =>
  err instanceof ApiError && err.status !== 0 && err.status < 500
    ? err.message
    : 'Não foi possível concluir. Tente de novo.';
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Criar conta, esqueci a senha e senha nova pelo link (D-099). Sem serviço de e-mail, o link sai no log da API. */
function AccountForms({
  mode,
  setMode,
  onLogin,
}: {
  mode: Exclude<Mode, 'login'>;
  setMode(m: Mode, notice?: string): void;
  onLogin(u: Me): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (f: FormData) => {
    if (mode === 'signup') {
      let siteUrl: string;
      try {
        siteUrl = new URL(str(f, 'siteUrl')).href;
      } catch {
        throw new ApiError(400, 'Endereço do site inválido (ex.: https://minhaloja.com.br).');
      }
      onLogin(
        await signup({
          name: str(f, 'name'),
          email: str(f, 'email'),
          password: String(f.get('password')),
          workspace: str(f, 'workspace'),
          siteUrl,
        }),
      );
    } else if (mode === 'forgot') setDone((await forgotPassword(str(f, 'email'))).message);
    else {
      if (f.get('password') !== f.get('confirm')) throw new ApiError(400, 'As senhas não conferem.');
      await resetPassword(resetToken() ?? '', String(f.get('password')));
      history.replaceState(null, '', location.pathname);
      setMode('login', 'Senha trocada. Entre com a senha nova.');
    }
  };

  const title = { signup: 'Criar conta', forgot: 'Esqueci minha senha', reset: 'Senha nova' }[mode];
  return (
    <form
      className="w-full max-w-sm"
      data-testid={`${mode}-form`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await submit(f);
        } catch (err) {
          setError(errorText(err));
        }
        setBusy(false);
      }}
    >
      <Logo className="mb-12 lg:hidden" />
      <p className="label-mono">Acesso</p>
      <h1 className="mt-2 font-display text-4xl font-normal text-ink">{title}</h1>
      {mode === 'forgot' && (
        <p className="mt-2 text-sm text-gray-600">
          Enviamos um link para criar uma senha nova (vale 30 minutos).
        </p>
      )}
      <div className="mt-8 space-y-4">
        {mode === 'signup' && (
          <>
            <Field label="Seu nome" name="name" autoComplete="name" autoFocus maxLength={200} />
            <Field label="E-mail" name="email" type="email" autoComplete="email" />
            <Field
              label="Senha"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              aria-describedby="pw-hint"
            />
            <PasswordHint />
            <Field label="Nome do workspace" name="workspace" placeholder="Minha loja" maxLength={200} />
            <Field
              label="Endereço do site"
              name="siteUrl"
              type="url"
              placeholder="https://minhaloja.com.br"
            />
          </>
        )}
        {mode === 'forgot' && !done && (
          <Field label="E-mail" name="email" type="email" autoComplete="email" autoFocus />
        )}
        {mode === 'reset' && (
          <>
            <Field
              label="Senha nova"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              autoFocus
              aria-describedby="pw-hint"
            />
            <PasswordHint />
            <Field label="Repita a senha" name="confirm" type="password" autoComplete="new-password" />
          </>
        )}
      </div>
      {done && (
        <p role="status" className="mt-4 rounded-md bg-gray-100 px-3 py-2 text-sm text-ink">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!done && (
        <Button type="submit" variant="primary" loading={busy} className="mt-6 w-full py-2.5">
          {mode === 'signup' ? 'Criar conta' : mode === 'forgot' ? 'Enviar link' : 'Trocar senha'}
        </Button>
      )}
      <button
        type="button"
        onClick={() => {
          if (mode === 'reset') history.replaceState(null, '', location.pathname);
          setMode('login');
        }}
        className="mt-3 w-full text-center text-sm text-gray-600 hover:text-ink"
      >
        Voltar para o login
      </button>
    </form>
  );
}

export function Login({ onLogin, initialError }: { onLogin(u: Me): void; initialError?: string | null }) {
  const [mode, setModeState] = useState<Mode>(resetToken() ? 'reset' : 'login');
  const [notice, setNotice] = useState<string | null>(null);
  const setMode = (m: Mode, n?: string) => {
    setModeState(m);
    setNotice(n ?? null);
  };
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  /** Senha certa, falta a 2ª etapa (quem tem TOTP ligado). */
  const [challenge, setChallenge] = useState<string | null>(null);
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside
        className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        <Logo dark className="relative" />
        <div className="relative max-w-lg">
          <p className="font-mono text-[11px] tracking-[0.14em] text-lime uppercase">
            Plataforma de otimização de conversão
          </p>
          {/* Slogan, não título: o H1 da página é o do formulário (ordem de títulos). */}
          <p className="mt-4 font-display text-[52px] leading-[1.02] font-light">
            Teste. Meça. <em className="text-lime not-italic">Decida.</em>
          </p>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
            Experimentos A/B e multivariados, mapas de calor, gravações de sessão, funis, formulários,
            pesquisas e personalização, sobre o seu site real, sem mexer no código.
          </p>
          <div className="mt-10">
            <SampleResult />
          </div>
        </div>
        <p className="relative font-mono text-[11px] text-white/55">
          editor visual · estatística bayesiana · dados first-party
        </p>
      </aside>

      <main className="flex flex-col items-center justify-center p-6">
        {mode !== 'login' ? (
          <AccountForms key={mode} mode={mode} setMode={setMode} onLogin={onLogin} />
        ) : challenge ? (
          <form
            className="w-full max-w-sm"
            data-testid="totp-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError(null);
              try {
                onLogin(await loginTotp(challenge, String(f.get('code'))));
              } catch (err) {
                const expired = err instanceof ApiError && /expirou/.test(err.message);
                setError(
                  err instanceof ApiError && err.status !== 0
                    ? err.message
                    : 'Não foi possível entrar. Tente de novo.',
                );
                if (expired) setChallenge(null);
                setBusy(false);
              }
            }}
          >
            <Logo className="mb-12 lg:hidden" />
            <p className="label-mono">Duas etapas</p>
            <h1 className="mt-2 font-display text-4xl font-normal text-ink">Código de verificação</h1>
            <p className="mt-2 text-sm text-gray-600">
              Digite o código de 6 dígitos do seu app autenticador. Sem o celular? Use um código de
              recuperação.
            </p>
            <label className="mt-8 block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Código</span>
              <input
                name="code"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={40}
                className={`${inputCls} font-mono tracking-widest`}
                aria-label="Código"
              />
            </label>
            {error && (
              <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="mt-6 w-full py-2.5">
              {busy ? 'Conferindo…' : 'Entrar'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              className="mt-3 w-full text-center text-sm text-gray-500 hover:text-ink"
            >
              Voltar
            </button>
          </form>
        ) : (
          <form
            className="w-full max-w-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError(null);
              try {
                const r = await login(String(f.get('email')), String(f.get('password')));
                if ('challenge' in r) {
                  setChallenge(r.challenge);
                  setBusy(false);
                } else onLogin(r);
              } catch (err) {
                setError(
                  err instanceof ApiError && err.status === 401
                    ? 'E-mail ou senha incorretos.'
                    : 'Não foi possível entrar. Tente de novo.',
                );
                setBusy(false);
              }
            }}
          >
            <Logo className="mb-12 lg:hidden" />
            <p className="label-mono">Acesso</p>
            <h1 className="mt-2 font-display text-4xl font-normal text-ink">Bem-vindo de volta</h1>
            <p className="mt-2 text-sm text-gray-600">Entre para ver seus experimentos e insights.</p>
            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">E-mail</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  className={inputCls}
                  aria-label="E-mail"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Senha</span>
                <span className="relative block">
                  <input
                    name="password"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className={`${inputCls} pr-16`}
                    aria-label="Senha"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-pressed={show}
                    aria-label="Mostrar senha"
                    className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 font-mono text-[11px] text-gray-600 hover:bg-gray-100"
                  >
                    {show ? 'ocultar' : 'mostrar'}
                  </button>
                </span>
              </label>
            </div>
            {notice && (
              <p role="status" className="mt-4 rounded-md bg-gray-100 px-3 py-2 text-sm text-ink">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="mt-6 w-full py-2.5">
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
            <div className="mt-4 flex justify-between text-sm">
              <button
                type="button"
                onClick={() => setMode('forgot')}
                className="text-gray-600 underline-offset-2 hover:text-ink hover:underline"
              >
                Esqueci minha senha
              </button>
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                Criar conta
              </button>
            </div>
          </form>
        )}
        <a href="/seguranca" className="mt-8 text-xs text-gray-600 underline hover:text-ink">
          Segurança e privacidade
        </a>
      </main>
    </div>
  );
}
