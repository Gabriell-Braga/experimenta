import type { TrackingEvent } from '@abtest/shared';
import { ArrowLeft, Fingerprint, Play, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { query, type RecordingRow } from '../api';
import { navigate } from '../nav';
import {
  Card,
  EmptyState,
  fmt,
  inputCls,
  PageHeader,
  Segmented,
  Spinner,
  Stat,
  timeAgo,
  useToast,
} from '../ui';
import { PERIODS, type Period } from './Events';
import { DEVICE_ICON } from './Recordings';

interface Profile {
  id: string;
  kind: 'user' | 'anon';
  userId?: string;
  visitors: string[];
  devices: string[];
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  pageviews: number;
  events: number;
  conversions: number;
  revenue: number;
  attributes: Record<string, string | number | boolean>;
  experiments: Record<string, string>;
}
interface ProfilesResponse {
  total: number;
  identified: number;
  crossDevice: {
    identified: number;
    multiDevice: number;
    multiBrowser: number;
    combos: { devices: string; count: number }[];
  };
  profiles: Profile[];
}

const nameOf = (p: Profile) => p.userId ?? `Anônimo ${p.visitors[0]!.slice(0, 8)}`;
const DEVICE_PT: Record<string, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' };

function Devices({ list }: { list: string[] }) {
  return (
    <span className="flex gap-1">
      {list.map((d) => {
        const I = DEVICE_ICON[d];
        return I ? <I key={d} size={13} className="text-gray-500" aria-label={DEVICE_PT[d]} /> : null;
      })}
    </span>
  );
}

export function ProfilesPage() {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'user' | 'anon'>('all');
  const [data, setData] = useState<ProfilesResponse | null>(null);
  useEffect(() => {
    document.title = 'Perfis | Experimenta';
  }, []);
  useEffect(() => {
    const t = setTimeout(
      () =>
        query<ProfilesResponse>('/profiles', {
          days,
          q: q || undefined,
          kind: kind === 'all' ? undefined : kind,
        }).then(setData, (e: Error) => toast('error', e.message)),
      q ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [days, q, kind, toast]);
  const cd = data?.crossDevice;
  return (
    <>
      <PageHeader
        eyebrow="Dados · CDP"
        title="Perfis"
        description="Uma visão por pessoa: quando o site chama abq.push(['identify', id]), todos os dispositivos e visitas dela se juntam num perfil só."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Perfis" value={fmt.int(data?.total ?? 0)} />
        <Stat
          label="Identificados"
          value={fmt.int(data?.identified ?? 0)}
          hint={data?.total ? fmt.pct((data.identified || 0) / data.total, 1) : undefined}
        />
        <Stat
          label="Usam 2+ dispositivos"
          value={fmt.int(cd?.multiDevice ?? 0)}
          hint={
            cd?.identified ? `${fmt.pct(cd.multiDevice / cd.identified, 0)} dos identificados` : undefined
          }
        />
        <Stat
          label="Combinação mais comum"
          value={<span className="text-base">{cd?.combos[0]?.devices ?? 'n/d'}</span>}
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por usuário, visitante ou atributo…"
          className={`${inputCls} max-w-sm`}
          aria-label="Buscar perfis"
        />
        <Segmented
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={[
            ['all', 'Todos'],
            ['user', 'Identificados'],
            ['anon', 'Anônimos'],
          ]}
        />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-900/10 bg-white">
        {!data ? (
          <div className="grid place-items-center py-16 text-gray-400">
            <Spinner />
          </div>
        ) : !data.profiles.length ? (
          <EmptyState icon={<Fingerprint size={20} aria-hidden="true" />} title="Nenhum perfil encontrado" />
        ) : (
          <table className="w-full text-left text-sm" data-testid="profiles">
            <thead className="border-b border-gray-900/10 bg-gray-50">
              <tr className="label-mono">
                <th className="px-4 py-2.5 font-medium">Perfil</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Dispositivos</th>
                <th className="px-4 py-2.5 text-right font-medium">Sessões</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Conversões</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Receita</th>
                <th className="px-4 py-2.5 text-right font-medium">Última visita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900/[0.06]">
              {data.profiles.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-lime-soft/40"
                  onClick={() => navigate('profile', { id: p.id })}
                  data-testid="profile-row"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${p.kind === 'user' ? 'bg-ink text-lime' : 'bg-gray-100 text-gray-400'}`}
                      >
                        <UserRound size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{nameOf(p)}</span>
                        <span className="block truncate font-mono text-[11px] text-gray-400">
                          {Object.entries(p.attributes)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(' · ') ||
                            `${p.visitors.length} visitante${p.visitors.length > 1 ? 's' : ''}`}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Devices list={p.devices} />
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs">{fmt.int(p.sessions)}</td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs sm:table-cell">
                    {fmt.int(p.conversions)}
                  </td>
                  <td className="tabular hidden px-4 py-3 text-right font-mono text-xs sm:table-cell">
                    {p.revenue ? fmt.money(p.revenue) : 'n/d'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs whitespace-nowrap text-gray-500">
                    {timeAgo(new Date(p.lastSeen).toISOString())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function describe(e: TrackingEvent): [string, string] {
  const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
  switch (e.type) {
    case 'pageview':
      return ['Página', path(e.url)];
    case 'event':
      return ['Evento', `${e.name}${e.value ? ` · ${fmt.money(e.value)}` : ''}`];
    case 'identify':
      return [
        'Identificação',
        [
          e.userId,
          e.attrs &&
            Object.entries(e.attrs)
              .map(([k, v]) => `${k}=${v}`)
              .join(', '),
        ]
          .filter(Boolean)
          .join(' · '),
      ];
    case 'conversion':
      return ['Conversão', `${e.goalKey} (${e.experimentKey})`];
    case 'exposure':
      return ['Experimento', `${e.experimentKey} → ${e.variationKey}`];
    case 'engage':
      return ['Engajamento', `${e.kind} ${e.action}`];
    case 'survey':
      return ['Pesquisa', `${e.answers.length} respostas`];
    case 'click':
      return ['Clique', e.selector];
    case 'frustration':
      return ['Frustração', `${e.kind} em ${e.selector}`];
    default:
      return [e.type, path(e.url)];
  }
}

export function ProfilePage({ id }: { id: string }) {
  const toast = useToast();
  const [d, setD] = useState<{
    profile: Profile;
    timeline: TrackingEvent[];
    recordings: RecordingRow[];
  } | null>(null);
  useEffect(() => {
    query<{ profile: Profile; timeline: TrackingEvent[]; recordings: RecordingRow[] }>(
      `/profiles/${encodeURIComponent(id)}`,
    ).then(setD, (e: Error) => toast('error', e.message));
  }, [id, toast]);
  if (!d)
    return (
      <div className="grid place-items-center py-24 text-gray-400">
        <Spinner />
      </div>
    );
  const p = d.profile;
  return (
    <>
      <button
        onClick={() => navigate('profiles')}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Perfis
      </button>
      <PageHeader
        eyebrow={p.kind === 'user' ? 'Perfil identificado' : 'Visitante anônimo'}
        title={nameOf(p)}
        description={
          <span className="flex flex-wrap gap-1.5">
            {Object.entries(p.attributes).map(([k, v]) => (
              <span
                key={k}
                className="rounded-sm bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-700"
              >
                {k}={String(v)}
              </span>
            ))}
          </span>
        }
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Sessões" value={fmt.int(p.sessions)} />
        <Stat label="Páginas vistas" value={fmt.int(p.pageviews)} />
        <Stat label="Conversões" value={fmt.int(p.conversions)} />
        <Stat label="Receita" value={fmt.money(p.revenue)} />
        <Stat
          label="Dispositivos"
          value={<Devices list={p.devices} />}
          hint={`${p.visitors.length} navegador(es)`}
        />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card title="Linha do tempo (todos os dispositivos)" pad={false}>
          <ol
            className="max-h-[560px] divide-y divide-gray-900/[0.05] overflow-y-auto"
            data-testid="profile-timeline"
          >
            {d.timeline.map((e) => {
              const [k, v] = describe(e);
              const I = 'device' in e ? DEVICE_ICON[e.device as string] : undefined;
              return (
                <li key={e.eventId} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="tabular w-28 shrink-0 font-mono text-[11px] text-gray-400">
                    {new Date(e.ts).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="w-24 shrink-0 font-mono text-[10.5px] text-gray-500 uppercase">{k}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-700">{v}</span>
                  {I && <I size={13} className="shrink-0 text-gray-400" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="space-y-5">
          <Card title="Experimentos">
            {Object.keys(p.experiments).length ? (
              <ul className="space-y-1 font-mono text-xs">
                {Object.entries(p.experiments).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="truncate">{k}</span>
                    <span className="text-brand-700">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">Nenhum.</p>
            )}
          </Card>
          <Card title="Gravações">
            {d.recordings.length ? (
              <ul className="space-y-1">
                {d.recordings.map((r) => (
                  <li key={r.sessionId}>
                    <button
                      onClick={() => navigate('recording', { id: r.sessionId })}
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-gray-50"
                    >
                      <Play size={13} aria-hidden="true" />{' '}
                      <span className="flex-1 truncate">{timeAgo(r.startedAt)}</span>
                      <span className="font-mono text-[11px] text-gray-500">{fmt.dur(r.durationMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">Sem gravações (a gravação é amostrada).</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
