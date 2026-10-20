import { useEffect, useState } from 'react';
import {
  APPROVALS_CHANGED,
  approvals,
  canApprove,
  getAccountSettings,
  saveAccountSettings,
  type Me,
  type PublishRequest,
} from '../api';
import { Button, Card, inputCls, PageHeader, Skeleton, timeAgo, useLoad, useToast } from '../ui';
import { Switch } from './Flags';

const DECIDED: Record<string, [string, string]> = {
  approved: ['Aprovado', 'bg-lime-soft text-brand-900 ring-brand-200'],
  rejected: ['Recusado', 'bg-red-50 text-red-800 ring-red-200'],
  pending: ['Aguardando', 'bg-amber-50 text-amber-800 ring-amber-200'],
};
function Badge({ status }: { status: string }) {
  const [label, cls] = DECIDED[status] ?? [status, ''];
  return (
    <span
      className={`inline-flex rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide whitespace-nowrap uppercase ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

const When = ({ iso }: { iso: string }) => (
  <time dateTime={iso} title={new Date(iso).toLocaleString('pt-BR')} className="text-xs text-gray-500">
    {timeAgo(iso)}
  </time>
);

/** Pedido pendente: quem aprova comenta e aprova (publica) ou recusa (comentário obrigatório). */
function PendingItem({ r, approver, onDone }: { r: PublishRequest; approver: boolean; onDone(): void }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const act = async (approve: boolean) => {
    if (!approve && !comment.trim()) return toast('error', 'Diga no comentário o que precisa mudar.');
    try {
      if (approve) {
        const { version } = await approvals.approve(r.id, comment.trim());
        toast('success', `Aprovado e publicado (versão ${version}). Vai ao ar em até 1 min.`);
      } else {
        await approvals.reject(r.id, comment.trim());
        toast('success', 'Pedido recusado. Quem pediu vê o seu comentário.');
      }
    } catch (err) {
      toast('error', (err as Error).message);
    }
    onDone();
  };
  return (
    <li className="space-y-2 px-4 py-3" data-testid="approval-pending">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <Badge status="pending" />
        <strong className="font-medium text-ink">{r.requestedBy.name}</strong>
        <span className="text-gray-600">pediu para publicar</span>
        <span className="ml-auto">
          <When iso={r.updatedAt} />
        </span>
      </div>
      {r.note && <p className="text-sm whitespace-pre-wrap text-gray-700">“{r.note}”</p>}
      {approver && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={1}
            placeholder="Comentário (obrigatório para recusar)"
            aria-label={`Comentário para ${r.requestedBy.name}`}
            className={`${inputCls} min-h-9 flex-1`}
          />
          <div className="flex shrink-0 gap-2">
            <Button variant="primary" onClick={() => act(true)} data-testid="approval-approve">
              Aprovar e publicar
            </Button>
            <Button onClick={() => act(false)} data-testid="approval-reject">
              Recusar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function RequestForm({ onDone }: { onDone(): void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  return (
    <Card title="Pedir publicação">
      <div className="space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="O que mudou e por quê (opcional)"
          aria-label="Recado para quem aprova"
          className={`${inputCls} w-full`}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Quem aprova publica tudo o que está salvo no momento. Clicar em Publicar em qualquer tela também
            cria o pedido.
          </p>
          <Button
            variant="primary"
            data-testid="approval-request"
            onClick={async () => {
              try {
                await approvals.request(note.trim());
                setNote('');
                toast('success', 'Pedido enviado.');
                onDone();
              } catch (err) {
                toast('error', (err as Error).message);
              }
            }}
          >
            Pedir
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ApprovalsPage({ user }: { user: Me }) {
  const toast = useToast();
  const approver = canApprove(user);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const { data: settings, setData: setSettings } = useLoad(() => getAccountSettings(), []);
  const { data: list } = useLoad(() => approvals.list(), [tick]);
  useEffect(() => {
    document.title = 'Aprovações · Experimenta';
    if (list) markSeen();
  }, [list]);
  const required = !!settings?.requireApproval;
  const pending = list?.filter((r) => r.status === 'pending') ?? [];
  const decided = list?.filter((r) => r.status !== 'pending') ?? [];

  const toggle = async (on: boolean) => {
    if (!settings) return;
    try {
      const s = await saveAccountSettings({ ...settings, requireApproval: on });
      setSettings(s);
      toast('success', on ? 'Aprovação ligada.' : 'Aprovação desligada: quem edita publica direto.');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Aprovações"
        description="Com aprovação ligada, quem edita pede a publicação e um owner (ou quem publica JS) aprova ou recusa com comentário."
      />
      <div className="mt-6 space-y-4">
        <Card>
          {!settings ? (
            <Skeleton className="h-5 w-2/3" />
          ) : (
            <div className="flex items-start gap-3">
              {user.role === 'owner' && (
                <Switch on={required} onChange={toggle} label="Exigir aprovação para publicar" />
              )}
              <span>
                <span className="block text-sm font-medium text-ink" data-testid="approval-mode">
                  {required ? 'Publicação exige aprovação' : 'Publicação sem aprovação'}
                </span>
                <span className="block text-xs text-gray-500">
                  {required
                    ? 'Mudanças de quem não pode aprovar só vão ao ar depois de aprovadas. O rebalanceamento automático continua publicando pesos, nunca mudanças pendentes. Avisos também por webhook (evento "Pedido de publicação").'
                    : 'Quem tem papel de editor publica direto.'}
                  {user.role !== 'owner' && ' Só o owner muda esta opção.'}
                </span>
              </span>
            </div>
          )}
        </Card>

        {required && !approver && user.role !== 'viewer' && <RequestForm onDone={reload} />}

        <Card title={`Pendentes${list ? ` (${pending.length})` : ''}`} pad={false}>
          {!list ? (
            <div className="p-4">
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : pending.length ? (
            <ul className="divide-y divide-gray-900/[0.06]">
              {pending.map((r) => (
                <PendingItem key={r.id} r={r} approver={approver} onDone={reload} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-gray-500" data-testid="approval-empty">
              Nenhum pedido aguardando.
            </p>
          )}
        </Card>

        {decided.length > 0 && (
          <Card title="Decididos" pad={false}>
            <ul className="divide-y divide-gray-900/[0.06]">
              {decided.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3 text-sm" data-testid="approval-decided">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge status={r.status} />
                    <span className="text-gray-700">
                      Pedido de <strong className="font-medium text-ink">{r.requestedBy.name}</strong>{' '}
                      {r.status === 'approved' ? 'aprovado' : 'recusado'} por{' '}
                      <strong className="font-medium text-ink">{r.decidedBy?.name}</strong>
                      {r.version !== undefined && ` (versão ${r.version})`}
                    </span>
                    <span className="ml-auto">
                      <When iso={r.decidedAt ?? r.updatedAt} />
                    </span>
                  </div>
                  {r.note && <p className="text-gray-500">Pedido: “{r.note}”</p>}
                  {r.comment && (
                    <p className="whitespace-pre-wrap text-gray-700">Comentário: “{r.comment}”</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

// ---------- Contador no menu ----------

const SEEN = 'abt.approvals.seen';
const markSeen = () => {
  try {
    localStorage.setItem(SEEN, new Date().toISOString());
  } catch {
    /* sem armazenamento: o contador só não esquece */
  }
  dispatchEvent(new Event(APPROVALS_CHANGED));
};

/**
 * Número no item "Aprovações" do menu: para quem aprova, os pedidos pendentes; para quem pediu, as respostas
 * aos seus pedidos que ainda não viu (aprovado/recusado depois da última visita à tela).
 */
export function approvalBadge(list: PublishRequest[], user: Me): number {
  if (canApprove(user)) return list.filter((r) => r.status === 'pending').length;
  let seen = '';
  try {
    seen = localStorage.getItem(SEEN) ?? '';
  } catch {
    /* idem */
  }
  return list.filter(
    (r) => r.status !== 'pending' && r.requestedBy.id === user.id && (r.decidedAt ?? '') > seen,
  ).length;
}
