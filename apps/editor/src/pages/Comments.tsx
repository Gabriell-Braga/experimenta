import { AtSign, MessageSquare, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { comments, MENTIONS_CHANGED, team, type CommentItem, type CommentTarget, type Me } from '../api';
import { navigate } from '../nav';
import { Button, Card, EmptyState, inputCls, PageHeader, Skeleton, timeAgo, useLoad, useToast } from '../ui';

// Comentários e @menções (fase 16.6): um componente só, usado no relatório do experimento, nas campanhas de
// engajamento (pop-ups, pesquisas) e nas ideias da Otimização por IA. O texto é sempre renderizado como texto
// (React escapa); a menção é só destaque visual de "@Nome" para os membros que o servidor confirmou.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Texto do comentário com as menções em destaque (sem HTML: só nós de texto e spans). */
export function CommentBody({ c }: { c: Pick<CommentItem, 'body' | 'mentions'> }) {
  const names = [...new Set(c.mentions.map((m) => m.name))].sort((a, b) => b.length - a.length);
  const parts = names.length
    ? c.body.split(new RegExp(`(@(?:${names.map(escapeRe).join('|')}))`, 'g'))
    : [c.body];
  return (
    <p className="text-sm break-words whitespace-pre-wrap text-gray-800" data-testid="comment-body">
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="rounded-sm bg-lime-soft px-0.5 font-medium text-brand-900">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </p>
  );
}

/** "@" seguido do começo de um nome, logo antes do cursor. */
const MENTION_AT = /(^|\s)@([^\s@]{0,30})$/u;

interface Props {
  targetType: CommentTarget;
  targetId: string;
  user: Me;
  /** Sem moldura de cartão (dentro de modal ou de outro cartão). */
  bare?: boolean;
}

export function Comments({ targetType, targetId, user, bare }: Props) {
  const toast = useToast();
  const { data: list, setData: setList } = useLoad(
    () => comments.list(targetType, targetId),
    [targetType, targetId],
  );
  const { data: members } = useLoad(() => team.members().catch(() => []), []);
  const [text, setText] = useState('');
  /** Membros escolhidos no autocompletar (id → nome); vale só quem ainda está como "@Nome" no texto. */
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  const options = useMemo(() => {
    if (query === null || !members) return [];
    const q = query.toLocaleLowerCase('pt-BR');
    return members
      .filter((m) => m.name.toLocaleLowerCase('pt-BR').includes(q) || m.email.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [query, members]);

  const onType = (value: string, caret: number) => {
    setText(value);
    const m = MENTION_AT.exec(value.slice(0, caret));
    setQuery(m ? m[2]! : null);
    setActive(0);
  };

  const pick = (m: { id: string; name: string }) => {
    const at = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, at).replace(/@[^\s@]*$/u, `@${m.name} `);
    const next = before + text.slice(at);
    setText(next);
    setPicked(new Map(picked).set(m.id, m.name));
    setQuery(null);
    caret.current = before.length;
  };
  // Cursor logo depois da menção inserida, antes do próximo caractere digitado.
  useLayoutEffect(() => {
    if (caret.current === null) return;
    area.current?.focus();
    area.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const mentions = [...picked].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    setBusy(true);
    try {
      const c = await comments.add({ targetType, targetId, body, mentions });
      setList([...(list ?? []), c]);
      setText('');
      setPicked(new Map());
      if (mentions.length) toast('success', 'Comentário enviado. Quem você mencionou foi avisado.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const remove = async (c: CommentItem) => {
    if (!confirm('Excluir este comentário?')) return;
    try {
      await comments.remove(c.id);
      setList((list ?? []).filter((x) => x.id !== c.id));
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const listboxId = `mentions-${targetType}-${targetId}`;
  const body = (
    <div className="space-y-3" data-testid="comments">
      {!list ? (
        <Skeleton className="h-4 w-2/3" />
      ) : list.length ? (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="group" data-testid="comment">
              <div className="flex items-baseline gap-2 text-xs">
                <strong className="text-sm font-medium text-ink">{c.userName}</strong>
                <time
                  dateTime={c.createdAt}
                  title={new Date(c.createdAt).toLocaleString('pt-BR')}
                  className="text-gray-500"
                >
                  {timeAgo(c.createdAt)}
                </time>
                {(c.userId === user.id || user.role === 'owner') && (
                  <button
                    onClick={() => remove(c)}
                    className="ml-auto text-gray-400 hover:text-red-600"
                    aria-label={`Excluir comentário de ${c.userName}`}
                    data-testid="comment-delete"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              <CommentBody c={c} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500" data-testid="comments-empty">
          Nenhum comentário ainda. Use @ para chamar alguém da equipe.
        </p>
      )}
      <div className="relative">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => onType(e.target.value, e.target.selectionStart)}
          onKeyDown={onKey}
          onBlur={() => setQuery(null)}
          maxLength={2000}
          rows={2}
          placeholder="Escreva um comentário… @ menciona alguém"
          aria-label="Novo comentário"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? `${listboxId}-${active}` : undefined}
          className={`${inputCls} w-full`}
          data-testid="comment-input"
        />
        {options.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Membros da conta"
            className="absolute z-20 mt-1 w-64 overflow-hidden rounded-md border border-gray-900/10 bg-white py-1 shadow-lg"
          >
            {options.map((m, i) => (
              <li
                key={m.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-brand-50 text-ink' : 'text-gray-700'}`}
                data-testid="mention-option"
              >
                <AtSign size={13} aria-hidden="true" className="text-gray-400" />
                <span className="truncate">{m.name}</span>
                <span className="ml-auto truncate text-xs text-gray-400">{m.email}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">Ctrl+Enter envia</span>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={submit}
            data-testid="comment-send"
          >
            Comentar
          </Button>
        </div>
      </div>
    </div>
  );
  return bare ? (
    body
  ) : (
    <Card title={`Comentários${list?.length ? ` (${list.length})` : ''}`} className="no-print">
      {body}
    </Card>
  );
}

// ---------- Menções: tela e contador no menu ----------

const TARGET: Record<CommentTarget, [string, (id: string) => void]> = {
  experiment: ['no teste', (id) => navigate('report', { id })],
  survey: ['na pesquisa', (id) => navigate('survey', { id })],
  popup: ['no pop-up', (id) => navigate('popups', { comments: id })],
  idea: ['na ideia', (id) => navigate('optimize', { idea: id })],
};

const SEEN = 'abt.mentions.seen';
const markSeen = () => {
  try {
    localStorage.setItem(SEEN, new Date().toISOString());
  } catch {
    /* sem armazenamento: o contador só não esquece */
  }
  dispatchEvent(new Event(MENTIONS_CHANGED));
};

/** Número no item "Menções" do menu: menções de outras pessoas depois da última visita à tela. */
export function mentionBadge(list: CommentItem[], user: Me): number {
  let seen = '';
  try {
    seen = localStorage.getItem(SEEN) ?? '';
  } catch {
    /* idem */
  }
  return list.filter((c) => c.userId !== user.id && c.createdAt > seen).length;
}

export function MentionsPage() {
  const { data: list } = useLoad(() => comments.mentions(), []);
  useEffect(() => {
    document.title = 'Menções · Experimenta';
    if (list) markSeen();
  }, [list]);
  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title="Menções"
        description="Comentários em que alguém da equipe chamou você com @ em testes, campanhas e ideias."
      />
      <div className="mt-6">
        {!list ? (
          <Card>
            <Skeleton className="h-4 w-2/3" />
          </Card>
        ) : list.length ? (
          <Card pad={false}>
            <ul className="divide-y divide-gray-900/[0.06]">
              {list.map((c) => {
                const [where, open] = TARGET[c.targetType] ?? ['em', () => {}];
                return (
                  <li key={c.id} className="space-y-1 px-4 py-3" data-testid="mention">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-gray-600">
                      <strong className="font-medium text-ink">{c.userName}</strong> mencionou você {where}
                      <button
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                        onClick={() => open(c.targetId)}
                        data-testid="mention-open"
                      >
                        {c.targetName}
                      </button>
                      <time dateTime={c.createdAt} className="ml-auto text-xs text-gray-500">
                        {timeAgo(c.createdAt)}
                      </time>
                    </div>
                    <CommentBody c={c} />
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <EmptyState icon={<MessageSquare size={20} aria-hidden="true" />} title="Nenhuma menção">
            Quando alguém escrever @ seu nome num comentário, aparece aqui e no contador do menu.
          </EmptyState>
        )}
      </div>
    </>
  );
}
