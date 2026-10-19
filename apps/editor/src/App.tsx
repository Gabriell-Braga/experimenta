import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, getExperiment, getToken, me, type ExperimentRecord, type Me } from './api';
import { EditorView } from './EditorView';
import { currentRoute, expParam, go, type Route } from './nav';
import { EventsPage } from './pages/Events';
import { ExperimentList } from './pages/Experiments';
import { FormsPage } from './pages/Forms';
import { HeatmapsPage, HeatmapViewer } from './pages/Heatmaps';
import { InstallPage } from './pages/Install';
import { Login } from './pages/Login';
import { RecordingPlayer, RecordingsPage } from './pages/Recordings';
import { ReportPage } from './pages/Report';
import { AppShell } from './shell';
import { Button, Spinner } from './ui';

/** Telas dentro da moldura (menu lateral). Chave = `?view=`. */
const PAGES: Record<string, (user: Me, route: Route) => ReactNode> = {
  tests: (user) => <ExperimentList user={user} />,
  install: (user) => <InstallPage user={user} />,
  events: () => <EventsPage />,
  heatmaps: () => <HeatmapsPage />,
  forms: () => <FormsPage />,
  recordings: (_, r) => <RecordingsPage params={r.params} />,
  report: (_, r) => <ReportPage key={r.params.get('id')} id={r.params.get('id') ?? ''} params={r.params} />,
};

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-full place-items-center text-gray-500">
      <span className="flex items-center gap-2 text-sm">
        <Spinner /> {label}
      </span>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<Me | null | undefined>(getToken() ? undefined : null);
  const [exp, setExp] = useState(expParam);
  const [route, setRoute] = useState(currentRoute);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === undefined) me().then(setUser, () => setUser(null));
  }, [user]);
  useEffect(() => {
    const onPop = () => {
      setExp(expParam());
      setRoute(currentRoute());
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    setRecord(null);
    setError(null);
    if (!user || !exp) return;
    getExperiment(exp).then(setRecord, (e: Error) =>
      setError(e instanceof ApiError && e.status === 404 ? 'Experimento não encontrado.' : e.message),
    );
  }, [user, exp]);

  if (user === undefined) return <FullPageSpinner label="Carregando…" />;
  if (!user) return <Login onLogin={setUser} />;
  if (!exp && route.view === 'heatmap' && route.params.get('url'))
    return <HeatmapViewer key={route.params.get('url')} url={route.params.get('url')!} />;
  if (!exp && route.view === 'recording' && route.params.get('id'))
    return <RecordingPlayer key={route.params.get('id')} id={route.params.get('id')!} />;
  if (!exp) {
    const view = PAGES[route.view] ? route.view : 'tests';
    return (
      <AppShell user={user} view={view === 'report' ? 'tests' : view}>
        {PAGES[view]!(user, route)}
      </AppShell>
    );
  }
  if (error)
    return (
      <div className="grid min-h-full place-items-center">
        <div className="text-center">
          <p role="alert" className="text-red-600">
            {error}
          </p>
          <Button className="mt-4" onClick={() => go(null)}>
            Voltar aos experimentos
          </Button>
        </div>
      </div>
    );
  return record ? (
    <EditorView key={record.experiment.id} record={record} user={user} />
  ) : (
    <FullPageSpinner label="Abrindo experimento…" />
  );
}
