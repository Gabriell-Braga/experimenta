import { useEffect, useState, type ReactNode } from 'react';
import { listActivities, team, type ActivityItem, type Role } from '../api';
import { setParams } from '../nav';
import { Button, Card, PageHeader, selectCls, Skeleton, timeAgo, useLoad, useToast } from '../ui';
import { ROLE_LABEL } from './Team';

/** Tipos de alvo (filtro "tipo") com o artigo usado na frase. */
export const TARGET_LABEL: Record<string, [string, string]> = {
  experiment: ['Testes e campanhas', 'o teste'],
  publish: ['Publicações e aprovações', 'a configuração'],
  project: ['Projetos', 'o projeto'],
  member: ['Membros', ''],
  invite: ['Convites', 'o convite de'],
  apikey: ['Chaves de API', 'a chave de API'],
  settings: ['Configurações da conta', ''],
  security: ['Login em duas etapas', ''],
  session: ['Sessões de login', ''],
  funnel: ['Funis', 'o funil'],
  audience: ['Audiências', 'a audiência'],
  segment: ['Segmentos', 'o segmento'],
  popup: ['Pop-ups', 'o pop-up'],
  survey: ['Pesquisas', 'a pesquisa'],
  reco: ['Recomendações', 'a recomendação'],
  flag: ['Feature flags', 'a flag'],
  webhook: ['Webhooks', 'o webhook'],
  integrations: ['Integrações', 'as integrações'],
  consent: ['Privacidade', 'a privacidade'],
  propensity: ['Modelo preditivo', 'o modelo preditivo'],
  group: ['Grupos exclusivos', 'o grupo exclusivo'],
  comment: ['Comentários', 'um comentário em'],
  idea: ['Backlog de hipóteses', 'a ideia'],
};

const VERB: Record<string, string> = {
  create: 'criou',
  update: 'editou',
  delete: 'excluiu',
  start: 'iniciou',
  pause: 'pausou',
  archive: 'arquivou',
  restore: 'restaurou',
  duplicate: 'duplicou',
  rebalance: 'rebalanceou',
  publish: 'publicou',
  preview: 'criou um link de pré-visualização para',
  preview_revoke: 'revogou um link de pré-visualização de',
};

const role = (d: string) => d.replace(/^(owner|editor|viewer)/, (r) => ROLE_LABEL[r as Role]);

/** "Fulana pausou o teste Hero" (pessoa e alvo em destaque). */
export function sentence(a: ActivityItem): ReactNode {
  const who = <strong className="font-medium text-ink">{a.userName}</strong>;
  const what = <strong className="font-medium text-ink">{a.targetName}</strong>;
  if (a.targetType === 'member') {
    if (a.action === 'join')
      return (
        <>
          {who} entrou na conta{a.detail && ` como ${role(a.detail)}`}
        </>
      );
    if (a.action === 'leave') return <>{who} saiu da conta</>;
    if (a.action === 'role')
      return (
        <>
          {who} mudou o papel de {what}
          {a.detail && ` para ${role(a.detail)}`}
        </>
      );
    return (
      <>
        {who} removeu {what} da conta
      </>
    );
  }
  if (a.targetType === 'security')
    return a.action === 'totp_on' ? (
      <>{who} ativou o login em duas etapas</>
    ) : a.action === 'totp_off' ? (
      <>{who} desativou o login em duas etapas</>
    ) : (
      <>{who} gerou novos códigos de recuperação</>
    );
  if (a.targetType === 'session')
    return a.action === 'revoke_all' ? (
      <>
        {who} saiu de todos os outros lugares{a.detail && ` (${a.detail})`}
      </>
    ) : (
      <>{who} encerrou uma sessão de login</>
    );
  // Backlog de hipóteses (18.3): detalhe = coluna de destino, teste ligado ou "ICE 7,3".
  if (a.targetType === 'idea' && a.action !== 'create' && a.action !== 'update' && a.action !== 'delete') {
    if (a.action === 'clear') return <>{who} limpou o backlog de hipóteses</>;
    const tail =
      a.action === 'move'
        ? `para ${a.detail ?? ''}`
        : a.action === 'link'
          ? `ao teste ${a.detail ?? ''}`
          : a.action === 'unlink'
            ? 'do teste'
            : `(${a.detail ?? ''})`;
    const verb = { move: 'moveu', link: 'ligou', unlink: 'desligou', prioritize: 'priorizou' }[a.action];
    return (
      <>
        {who} {verb ?? a.action} a ideia {what} {tail}
      </>
    );
  }
  if (a.targetType === 'publish') {
    const note = a.detail && <span className="text-gray-500"> ({a.detail})</span>;
    if (a.action === 'request')
      return (
        <>
          {who} pediu aprovação para publicar{note}
        </>
      );
    if (a.action === 'approve')
      return (
        <>
          {who} aprovou a publicação pedida por {what}
          {note}
        </>
      );
    if (a.action === 'reject')
      return (
        <>
          {who} recusou a publicação pedida por {what}
          {note}
        </>
      );
    return (
      <>
        {who} publicou a {what}
      </>
    );
  }
  // CRM (19.1): sincronização manual com HubSpot/Salesforce.
  if (a.targetType === 'integrations' && a.action === 'sync')
    return (
      <>
        {who} sincronizou os perfis com o {what}
        {a.detail && ` (${a.detail})`}
      </>
    );
  // Agendamento (17.4): detalhe `start@ISO`, mostrado no fuso de quem lê.
  if (a.action.startsWith('schedule')) {
    const [act, at] = (a.detail ?? '').split('@');
    const verb =
      a.action === 'schedule_cancel'
        ? 'cancelou o agendamento de'
        : a.action === 'schedule_edit'
          ? 'mudou o agendamento para'
          : 'agendou';
    return (
      <>
        {who} {verb} {act === 'pause' ? 'pausar' : 'iniciar'} o teste {what}
        {at && ` em ${new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
      </>
    );
  }
  const noun = TARGET_LABEL[a.targetType]?.[1] ?? a.targetType;
  const verb = a.action === 'draft' ? 'voltou' : (VERB[a.action] ?? a.action);
  const extra =
    a.action === 'draft'
      ? ' para rascunho'
      : a.detail &&
          (a.action === 'restore' ||
            // Execução do agendamento: "(agendado por Fulano · publicado na versão 7)".
            ((a.action === 'start' || a.action === 'pause') && !a.userId) ||
            a.action.startsWith('preview') ||
            a.targetType === 'invite' ||
            a.targetType === 'integrations' ||
            a.targetType === 'settings')
        ? ` (${role(a.detail)})`
        : '';
  return (
    <>
      {who} {verb} {noun && `${noun} `}
      {what}
      {extra}
    </>
  );
}

/** Lista paginada do histórico. Usada na tela Atividades e na linha do tempo do experimento. */
export function ActivityList({
  userId,
  type,
  targetId,
}: {
  userId?: string;
  type?: string;
  targetId?: string;
}) {
  const toast = useToast();
  const { data, setData } = useLoad(
    () => listActivities({ userId, type, targetId }),
    [userId, type, targetId],
  );
  const more = async () => {
    if (!data?.next) return;
    try {
      const page = await listActivities({ userId, type, targetId, before: data.next });
      setData((d) => d && { items: [...d.items, ...page.items], next: page.next });
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  if (!data)
    return (
      <ul className="divide-y divide-gray-900/[0.06]" role="status" aria-label="Carregando">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="ml-auto h-3.5 w-16" />
          </li>
        ))}
      </ul>
    );
  if (!data.items.length)
    return (
      <p className="px-4 py-6 text-center text-sm text-gray-500" data-testid="activity-empty">
        Nenhuma atividade{userId || type ? ' com esses filtros' : ''}.
      </p>
    );
  return (
    <>
      <ol className="divide-y divide-gray-900/[0.06]" data-testid="activities">
        {data.items.map((a) => (
          <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm" data-testid="activity">
            <span className="min-w-0 flex-1 text-gray-700">{sentence(a)}</span>
            <time
              dateTime={a.createdAt}
              title={new Date(a.createdAt).toLocaleString('pt-BR')}
              className="shrink-0 text-xs whitespace-nowrap text-gray-500"
            >
              {timeAgo(a.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      {data.next && (
        <div className="border-t border-gray-900/[0.06] p-3 text-center">
          <Button size="sm" onClick={more} data-testid="activity-more">
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}

export function ActivityPage({ params }: { params: URLSearchParams }) {
  const [userId, setUserId] = useState(params.get('user') ?? '');
  const [type, setType] = useState(params.get('type') ?? '');
  const { data: members } = useLoad(() => team.members(), []);
  useEffect(() => {
    document.title = 'Atividades · Experimenta';
  }, []);
  useEffect(() => {
    setParams({ user: userId || undefined, type: type || undefined });
  }, [userId, type]);
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Atividades"
        description="Quem criou, editou, publicou, pausou ou excluiu o quê nesta conta, e quando."
      />
      <div className="mt-6 flex flex-wrap gap-2">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={selectCls}
          aria-label="Filtrar por pessoa"
        >
          <option value="">Todas as pessoas</option>
          {members?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={selectCls}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TARGET_LABEL).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Card className="mt-4" pad={false}>
        <ActivityList userId={userId || undefined} type={type || undefined} />
      </Card>
    </>
  );
}

/** Linha do tempo de um experimento (dentro do relatório). */
export function ExperimentTimeline({ id }: { id: string }) {
  return (
    <Card title="Atividades" pad={false} className="no-print">
      <ActivityList targetId={id} />
    </Card>
  );
}
