import type { CampaignType } from '@abtest/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ApiError,
  getExperiment,
  getToken,
  me,
  takeSsoResult,
  TOTP_REQUIRED,
  type ExperimentRecord,
  type Me,
} from './api';
import { EditorView } from './EditorView';
import { currentRoute, expParam, go, type Route } from './nav';
import { ActivityPage } from './pages/Activity';
import { ApprovalsPage } from './pages/Approvals';
import { AudiencesPage } from './pages/Audiences';
import { MentionsPage } from './pages/Comments';
import { CohortsPage } from './pages/Cohorts';
import { DashboardPage } from './pages/Dashboard';
import { EventsPage } from './pages/Events';
import { ExperimentList } from './pages/Experiments';
import { FlagsPage } from './pages/Flags';
import { FormsPage } from './pages/Forms';
import { FunnelsPage } from './pages/Funnels';
import { JourneysPage } from './pages/Journeys';
import { HeatmapsPage, HeatmapViewer } from './pages/Heatmaps';
import { InstallPage } from './pages/Install';
import { AcceptInvite } from './pages/Invite';
import { IntegrationsPage } from './pages/Integrations';
import { Login } from './pages/Login';
import { OptimizePage } from './pages/Optimize';
import { PopupsPage } from './pages/Popups';
import { PredictivePage } from './pages/Predictive';
import { PrivacyPage } from './pages/Privacy';
import { ProfilePage, ProfilesPage } from './pages/Profiles';
import { SurveyReportPage, SurveysPage } from './pages/Surveys';
import { RecordingPlayer, RecordingsPage } from './pages/Recordings';
import { RecosPage } from './pages/Recos';
import { SecurityPage, TotpGate } from './pages/Security';
import { SegmentsPage } from './pages/Segments';
import { ReportPage } from './pages/Report';
import { ServerExperimentPage } from './pages/ServerExperiment';
import { TeamPage } from './pages/Team';
import { AppShell } from './shell';
import { Button, Spinner } from './ui';

/** Telas dentro da moldura (menu lateral). Chave = `?view=`. */
const PAGES: Record<string, (user: Me, route: Route) => ReactNode> = {
  tests: (user, r) => (
    <ExperimentList
      key={r.params.get('type')}
      user={user}
      type={(r.params.get('type') as CampaignType) || undefined}
    />
  ),
  home: () => <DashboardPage />,
  mentions: () => <MentionsPage />,
  install: (user) => <InstallPage user={user} />,
  integrations: (user) => <IntegrationsPage user={user} />,
  privacy: (user) => <PrivacyPage user={user} />,
  team: (user) => <TeamPage user={user} />,
  security: (user) => <SecurityPage user={user} />,
  activity: (_, r) => <ActivityPage params={r.params} />,
  approvals: (user) => <ApprovalsPage user={user} />,
  events: () => <EventsPage />,
  flags: (user) => <FlagsPage user={user} />,
  optimize: (user) => <OptimizePage user={user} />,
  popups: (user) => <PopupsPage user={user} />,
  profiles: () => <ProfilesPage />,
  segments: (user) => <SegmentsPage user={user} />,
  profile: (_, r) => <ProfilePage key={r.params.get('id')} id={r.params.get('id') ?? ''} />,
  recos: (user) => <RecosPage user={user} />,
  surveys: (user) => <SurveysPage user={user} />,
  survey: (user, r) => (
    <SurveyReportPage key={r.params.get('id')} id={r.params.get('id') ?? ''} user={user} />
  ),
  audiences: (user) => <AudiencesPage user={user} />,
  server: (_, r) => <ServerExperimentPage key={r.params.get('id')} id={r.params.get('id') ?? ''} />,
  heatmaps: () => <HeatmapsPage />,
  forms: () => <FormsPage />,
  funnels: (user) => <FunnelsPage user={user} />,
  journeys: () => <JourneysPage />,
  cohorts: () => <CohortsPage />,
  predictive: (user) => <PredictivePage user={user} />,
  recordings: (_, r) => <RecordingsPage params={r.params} />,
  report: (user, r) => (
    <ReportPage key={r.params.get('id')} id={r.params.get('id') ?? ''} params={r.params} user={user} />
  ),
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

/** Volta do SSO: lida uma vez, antes do primeiro render (o token entra no localStorage). */
const ssoError = takeSsoResult();

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
    // A conta passou a exigir duas etapas no meio do uso: recarrega o /me (mostra a configuração).
    const onRequired = () => setUser(undefined);
    addEventListener(TOTP_REQUIRED, onRequired);
    return () => removeEventListener(TOTP_REQUIRED, onRequired);
  }, []);
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

  const invite = route.params.get('invite');
  if (invite) return <AcceptInvite token={invite} />;
  if (user === undefined) return <FullPageSpinner label="Carregando…" />;
  // Depois do login, busca o /me (traz as contas da pessoa para o menu).
  if (!user) return <Login onLogin={() => setUser(undefined)} initialError={ssoError} />;
  if (user.totpRequired) return <TotpGate user={user} onDone={() => setUser(undefined)} />;
  if (!exp && route.view === 'heatmap' && route.params.get('url'))
    return <HeatmapViewer key={route.params.get('url')} url={route.params.get('url')!} />;
  if (!exp && route.view === 'recording' && route.params.get('id'))
    return <RecordingPlayer key={route.params.get('id')} id={route.params.get('id')!} />;
  if (!exp) {
    const view = PAGES[route.view] ? route.view : 'tests';
    return (
      <AppShell
        user={user}
        view={
          view === 'report' || view === 'server'
            ? 'tests'
            : view === 'survey'
              ? 'surveys'
              : view === 'profile'
                ? 'profiles'
                : view === 'tests' && route.params.get('type')
                  ? `tests:${route.params.get('type')}`
                  : view
        }
      >
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
