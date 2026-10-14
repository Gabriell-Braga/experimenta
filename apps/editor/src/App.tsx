import { useEffect, useState } from 'react';
import {
  ApiError,
  getExperiment,
  getToken,
  listExperiments,
  listProjects,
  login,
  logout,
  me,
  saveExperiment,
  type ExperimentRecord,
  type ExperimentSummary,
  type Me,
} from './api';
import { EditorView } from './EditorView';
import { newExperiment } from './store';

/** Roteamento mínimo: ?exp=<id> abre o editor; sem parâmetro, lista de experimentos. */
const expParam = () => new URLSearchParams(location.search).get('exp');
function go(exp: string | null) {
  history.pushState(null, '', exp ? `?exp=${encodeURIComponent(exp)}` : location.pathname);
  dispatchEvent(new PopStateEvent('popstate'));
}

function Login({ onLogin }: { onLogin(u: Me): void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="m-auto mt-24 flex w-80 flex-col gap-3 rounded-xl bg-white p-6 shadow"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          onLogin(await login(String(f.get('email')), String(f.get('password'))));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'erro');
        }
      }}
    >
      <h1 className="text-lg font-semibold">Entrar</h1>
      <input
        name="email"
        type="email"
        placeholder="e-mail"
        required
        className="rounded border p-2"
        aria-label="E-mail"
      />
      <input
        name="password"
        type="password"
        placeholder="senha"
        required
        className="rounded border p-2"
        aria-label="Senha"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button className="rounded bg-orange-500 p-2 text-white">Entrar</button>
    </form>
  );
}

function ExperimentList({ user }: { user: Me }) {
  const [items, setItems] = useState<ExperimentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listExperiments().then(setItems, (e: Error) => setError(e.message));
  }, []);

  const create = async () => {
    try {
      const [project] = await listProjects();
      if (!project) throw new Error('crie um projeto primeiro');
      const experiment = newExperiment(project.siteUrl);
      await saveExperiment({ experiment, projectId: project.id, editorUrl: project.siteUrl }, true);
      go(experiment.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro');
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Experimentos</h1>
        <span className="flex items-center gap-3 text-sm text-gray-500">
          {user.name} ({user.role})
          <button
            onClick={() => {
              logout();
              location.reload();
            }}
            className="underline"
          >
            sair
          </button>
        </span>
      </header>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {user.role !== 'viewer' && (
        <button
          onClick={create}
          className="mb-4 rounded bg-orange-500 px-3 py-2 text-white"
          data-testid="new-experiment"
        >
          Novo experimento
        </button>
      )}
      <ul className="divide-y rounded bg-white shadow" data-testid="experiment-list">
        {items?.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => go(e.id)}
              className="flex w-full justify-between px-4 py-3 text-left hover:bg-gray-50"
            >
              <span>{e.name}</span>
              <span className="text-xs text-gray-500">{e.status}</span>
            </button>
          </li>
        ))}
        {items?.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">Nenhum experimento ainda.</li>
        )}
      </ul>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<Me | null | undefined>(getToken() ? undefined : null);
  const [exp, setExp] = useState(expParam);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === undefined) me().then(setUser, () => setUser(null));
  }, [user]);
  useEffect(() => {
    const onPop = () => setExp(expParam());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    setRecord(null);
    if (!user || !exp) return;
    getExperiment(exp).then(setRecord, (e: Error) =>
      setError(e instanceof ApiError && e.status === 404 ? 'Experimento não encontrado.' : e.message),
    );
  }, [user, exp]);

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;
  if (!exp) return <ExperimentList user={user} />;
  if (error)
    return (
      <p role="alert" className="p-6 text-red-600">
        {error}
      </p>
    );
  return record ? <EditorView key={record.experiment.id} record={record} /> : null;
}
