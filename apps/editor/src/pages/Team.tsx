import { Copy, MailPlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  inviteLink,
  logout,
  switchAccount,
  team,
  type Invite,
  type Me,
  type Member,
  type Role,
} from '../api';
import {
  Button,
  Card,
  inputCls,
  PageHeader,
  selectCls,
  Skeleton,
  timeAgo,
  useCopy,
  useLoad,
  useToast,
} from '../ui';
import { Switch } from './Flags';

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Leitura' };
const ROLE_HINT: Record<Role, string> = {
  owner: 'tudo, inclusive equipe, chaves e publicar JS',
  editor: 'cria, edita e publica testes e campanhas',
  viewer: 'só vê relatórios e configurações',
};

function RoleSelect({ value, onChange, label }: { value: Role; onChange(r: Role): void; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
      className={selectCls}
      aria-label={label}
    >
      {(['viewer', 'editor', 'owner'] as const).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

/** Sai da conta atual: vai para outra conta da pessoa (ou para o login, se não sobrar nenhuma). */
async function leave(user: Me) {
  const next = user.accounts?.find((a) => a.id !== user.accountId);
  if (next) await switchAccount(next.id).catch(logout);
  else logout();
  location.href = location.pathname;
}

function Members({ user }: { user: Me }) {
  const toast = useToast();
  const { data: list, setData, reload } = useLoad(() => team.members(), []);
  const isOwner = user.role === 'owner';
  const update = async (m: Member, access: { role: Role; canPublishJs: boolean }) => {
    try {
      await team.update(m.id, access);
      setData((l) => l && l.map((x) => (x.id === m.id ? { ...x, ...access } : x)));
      if (m.id === user.id) location.reload(); // o próprio papel mudou: menus e permissões da tela também
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const remove = async (m: Member) => {
    const self = m.id === user.id;
    if (!confirm(self ? 'Sair desta conta? Você perde o acesso a ela.' : `Remover ${m.name} da conta?`))
      return;
    try {
      await team.remove(m.id);
      if (self) return leave(user);
      reload();
      toast('success', `${m.name} saiu da conta.`);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Card title="Membros" pad={false}>
      <ul className="divide-y divide-gray-900/[0.06]" data-testid="members">
        {!list &&
          [0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="ml-auto h-3.5 w-20" />
            </li>
          ))}
        {list?.map((m) => {
          const self = m.id === user.id;
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              data-testid="member"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">
                  {m.name} {self && <span className="text-xs font-normal text-gray-500">(você)</span>}
                </span>
                <span className="block truncate text-xs text-gray-500">{m.email}</span>
              </span>
              {isOwner ? (
                <>
                  {m.role !== 'owner' && (
                    <span className="flex items-center gap-2 text-xs text-gray-600">
                      <Switch
                        on={m.canPublishJs}
                        label={`${m.name} pode publicar JS`}
                        onChange={(canPublishJs) => update(m, { role: m.role, canPublishJs })}
                      />
                      publica JS
                    </span>
                  )}
                  <RoleSelect
                    value={m.role}
                    label={`Papel de ${m.name}`}
                    onChange={(role) => update(m, { role, canPublishJs: m.canPublishJs })}
                  />
                </>
              ) : (
                <span className="label-mono">{ROLE_LABEL[m.role]}</span>
              )}
              {(isOwner || self) && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={self ? 'Sair da conta' : `Remover ${m.name}`}
                  onClick={() => remove(m)}
                >
                  {self ? 'Sair' : <Trash2 size={14} />}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Invites() {
  const toast = useToast();
  const copy = useCopy();
  const { data: list, reload } = useLoad(() => team.invites(), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const create = async () => {
    try {
      const r = await team.invite(email.trim(), role, false);
      setLink({ email: email.trim(), url: inviteLink(r.token) });
      setEmail('');
      reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Card title="Convidar">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@empresa.com"
          aria-label="E-mail de quem convidar"
          className={`${inputCls} min-w-48 flex-1`}
          maxLength={200}
        />
        <RoleSelect value={role} onChange={setRole} label="Papel do convite" />
        <Button
          type="submit"
          variant="primary"
          disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
          onClick={create}
          data-testid="invite-create"
        >
          <MailPlus size={14} aria-hidden="true" /> Gerar convite
        </Button>
      </form>
      <p className="mt-2 text-xs text-gray-500">{ROLE_HINT[role]}.</p>
      {link && (
        <div
          className="mt-3 rounded-md border border-brand-500/30 bg-brand-50 p-3 text-xs"
          data-testid="invite-link"
        >
          <p className="mb-1 font-medium text-ink">
            Mande este link para {link.email}. Vale 7 dias, uma vez, e não aparece de novo.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono break-all">{link.url}</code>
            <Button size="sm" onClick={() => copy(link.url, 'Link copiado.')}>
              <Copy size={12} aria-hidden="true" /> Copiar
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-3 divide-y divide-gray-900/[0.06]" data-testid="invites">
        {list?.map((i: Invite) => (
          <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{i.email}</span>
            <span className="label-mono">{ROLE_LABEL[i.role]}</span>
            <span className="text-xs text-gray-500">
              {Date.parse(i.expiresAt) < Date.now() ? 'expirado' : `enviado ${timeAgo(i.createdAt)}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Cancelar convite de ${i.email}`}
              onClick={() => team.revoke(i.id).then(reload, (e: Error) => toast('error', e.message))}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      {list?.length === 0 && <p className="mt-3 text-xs text-gray-500">Nenhum convite pendente.</p>}
    </Card>
  );
}

export function TeamPage({ user }: { user: Me }) {
  useEffect(() => {
    document.title = 'Equipe · Experimenta';
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="Configurar"
        title="Equipe"
        description="Quem acessa esta conta e com que papel. Uma pessoa pode estar em várias contas e troca de conta no menu do usuário."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Members user={user} />
        {user.role === 'owner' && <Invites />}
      </div>
    </>
  );
}
