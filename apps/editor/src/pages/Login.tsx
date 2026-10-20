import { useState } from 'react';
import { ApiError, login, loginTotp, type Me } from '../api';
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

export function Login({ onLogin, initialError }: { onLogin(u: Me): void; initialError?: string | null }) {
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
          <h2 className="mt-4 font-display text-[52px] leading-[1.02] font-light">
            Teste. Meça. <em className="text-lime not-italic">Decida.</em>
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
            Experimentos A/B e multivariados, mapas de calor, gravações de sessão, funis, formulários,
            pesquisas e personalização, sobre o seu site real, sem mexer no código.
          </p>
          <div className="mt-10">
            <SampleResult />
          </div>
        </div>
        <p className="relative font-mono text-[11px] text-white/30">
          editor visual · estatística bayesiana · dados first-party
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        {challenge ? (
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
                    className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 font-mono text-[11px] text-gray-500 hover:bg-gray-100"
                  >
                    {show ? 'ocultar' : 'mostrar'}
                  </button>
                </span>
              </label>
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="mt-6 w-full py-2.5">
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
