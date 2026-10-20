import { useEffect, useState } from 'react';
import { acceptInvite, ApiError, inviteInfo } from '../api';
import { Button, inputCls, Logo, Spinner } from '../ui';
import { ROLE_LABEL } from './Team';

/** Quem recebeu o link `?invite=`: entra com a senha (já tem login) ou cria o login (nome + senha). */
export function AcceptInvite({ token }: { token: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof inviteInfo>> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    inviteInfo(token).then(setInfo, () => setInfo(null));
  }, [token]);
  const done = () => (location.href = location.pathname); // sai do ?invite= e abre o app já na conta
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm">
        <Logo className="mb-10" />
        {info === undefined && (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner /> Abrindo convite…
          </p>
        )}
        {info === null && (
          <>
            <h1 className="font-display text-3xl text-ink">Convite inválido</h1>
            <p className="mt-2 text-sm text-gray-600">
              O link expirou, já foi usado ou foi cancelado. Peça um novo convite a quem convidou você.
            </p>
            <Button className="mt-6" onClick={done}>
              Ir para o login
            </Button>
          </>
        )}
        {info && (
          <form
            data-testid="invite-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                await acceptInvite(token, {
                  password: String(f.get('password')),
                  ...(info.hasUser ? {} : { name: String(f.get('name')).trim() }),
                  ...(info.hasTotp ? { code: String(f.get('code')) } : {}),
                });
                done();
              } catch (err) {
                setError(
                  err instanceof ApiError && err.status === 401 && !info.hasTotp
                    ? 'Senha incorreta.'
                    : (err as Error).message,
                );
                setBusy(false);
              }
            }}
          >
            <p className="label-mono">Convite</p>
            <h1 className="mt-2 font-display text-3xl text-ink">Entrar em {info.accountName}</h1>
            <p className="mt-2 text-sm text-gray-600">
              Para <b>{info.email}</b>, com papel <b>{ROLE_LABEL[info.role]}</b>.{' '}
              {info.hasUser ? 'Confirme sua senha para aceitar.' : 'Crie seu acesso.'}
            </p>
            <div className="mt-6 space-y-4">
              {!info.hasUser && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Seu nome</span>
                  <input name="name" required maxLength={200} autoComplete="name" className={inputCls} />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {info.hasUser ? 'Senha' : 'Senha (mínimo 8 caracteres)'}
                </span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={info.hasUser ? 1 : 8}
                  maxLength={200}
                  autoComplete={info.hasUser ? 'current-password' : 'new-password'}
                  className={inputCls}
                />
              </label>
              {info.hasTotp && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">
                    Código do app autenticador (ou de recuperação)
                  </span>
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={40}
                    className={`${inputCls} font-mono tracking-widest`}
                  />
                </label>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              className="mt-6 w-full py-2.5"
              data-testid="invite-accept"
            >
              Aceitar convite
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
