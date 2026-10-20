import { IDEA_STAGES, iceScore, type Ice, type IdeaStage } from '@abtest/shared';
import { Copy, Link2, MessageSquare, Pencil, Plane, Plus, Sparkles, Trash2, Unlink } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ideas,
  listExperiments,
  type IdeaResult,
  type Ideas,
  type IdeaText,
  type Me,
  type SavedIdea,
} from '../api';
import { putIdeaSeed } from '../components/AiPanel';
import { go } from '../nav';
import {
  Button,
  Card,
  EmptyState,
  fmt,
  inputCls,
  LoadingBlock,
  Modal,
  PageHeader,
  Segmented,
  selectCls,
  StatusBadge,
  timeAgo,
  useCopy,
  useLoad,
  useToast,
} from '../ui';
import { Comments } from './Comments';
import { PERIODS, type Period } from './Events';

const LEVEL: Record<string, string> = {
  alto: 'bg-brand-50 text-brand-700',
  médio: 'bg-gray-100 text-gray-700',
  baixo: 'bg-gray-50 text-gray-500',
};

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase ${LEVEL[value] ?? ''}`}
    >
      {label} {value}
    </span>
  );
}

const SOURCE: Record<string, (model?: string) => string> = {
  claude: (m) => `por Claude (${m})`,
  modelo: (m) => `por IA (${m})`,
  regras: () => 'por regras · sem modelo de IA configurado',
};

/** Colunas do quadro (ideia → priorizada → em teste → concluída). */
const STAGE: Record<IdeaStage, { label: string; help: string }> = {
  idea: { label: 'Ideias', help: 'Novas, da IA ou da equipe' },
  prioritized: { label: 'Priorizadas', help: 'Com ICE, na fila' },
  testing: { label: 'Em teste', help: 'Com teste ligado' },
  done: { label: 'Concluídas', help: 'Com o resultado' },
};

/** Colunas para onde a ideia pode ir: com teste ligado, só "em teste" e "concluída" (o teste manda). */
const targets = (i: SavedIdea) =>
  IDEA_STAGES.filter(
    (s) => s !== i.stage && (!linked(i) || s === 'testing' || s === 'done') && (s !== 'testing' || linked(i)),
  );
const linked = (i: SavedIdea) => !!i.experimentId && i.experimentStatus !== 'deleted';

/** Maior ICE primeiro; sem ICE no fim, mais nova primeiro. */
const byScore = (a: SavedIdea, b: SavedIdea) =>
  (b.score ?? -1) - (a.score ?? -1) || b.createdAt.localeCompare(a.createdAt);

/** Sugestão de ICE a partir das etiquetas da IA (o usuário ajusta). */
const LEVEL_SCORE: Record<string, number> = { alto: 8, médio: 5, baixo: 3 };
const suggestIce = (i: SavedIdea): Ice =>
  i.ice ?? {
    impact: LEVEL_SCORE[i.impact] ?? 5,
    confidence: 5,
    ease: 11 - (LEVEL_SCORE[i.effort] ?? 6),
  };

const OUTCOME: Record<IdeaResult['outcome'], [string, string]> = {
  winner: ['Vencedora', 'bg-lime-soft text-brand-900'],
  loser: ['Perdedora', 'bg-red-50 text-signal'],
  inconclusive: ['Inconclusivo', 'bg-gray-100 text-gray-700'],
};

/** Resultado da ideia concluída: guardado, ou calculado agora do relatório do teste ligado (um por cartão). */
function ResultLine({ i }: { i: SavedIdea }) {
  const [r, setR] = useState<IdeaResult | null | undefined>(i.result);
  useEffect(() => {
    if (i.result || !linked(i)) return;
    let live = true;
    ideas.result(i.id).then(
      (x) => live && setR(x.result),
      () => live && setR(null),
    );
    return () => {
      live = false;
    };
  }, [i.id, i.result, i.experimentStatus]);
  if (!linked(i)) return <p className="text-xs text-gray-500">Sem teste ligado: sem resultado medido.</p>;
  if (r === undefined) return <p className="text-xs text-gray-400">Calculando o resultado…</p>;
  if (!r) return <p className="text-xs text-gray-500">O teste ainda não tem dados.</p>;
  const [label, cls] = OUTCOME[r.outcome];
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700" data-testid="idea-result">
      <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${cls}`}>
        {label}
      </span>
      {r.variation && <span>{r.variation}</span>}
      {r.lift !== null && (
        <span className="tabular font-medium">
          {r.lift >= 0 ? '+' : ''}
          {fmt.pct(r.lift)}
        </span>
      )}
      <span className="text-gray-500">
        em {r.goal} · {fmt.int(r.visitors)} visitantes{r.final ? '' : ' · parcial, teste não arquivado'}
      </span>
    </p>
  );
}

function IdeaCard({
  i,
  canEdit,
  user,
  onChange,
  onEdit,
  onPrioritize,
  onLink,
}: {
  i: SavedIdea;
  canEdit: boolean;
  user: Me;
  onChange(p: Promise<Ideas>): Promise<boolean>;
  onEdit(): void;
  onPrioritize(): void;
  onLink(): void;
}) {
  const copy = useCopy();
  const toast = useToast();
  // Ref além do estado: dois cliques no mesmo instante não podem pedir duas vezes (a API também é idempotente).
  const creating = useRef(false);
  const [busy, setBusy] = useState(false);
  const createTest = async () => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      const r = await ideas.createTest(i.id);
      // Só no teste recém-criado: o editor abre a aba IA com a mudança da ideia (e gera, se houver IA).
      if (r.created)
        putIdeaSeed(r.id, { title: i.title, change: i.change, auto: r.ai, goalCreated: r.goalCreated });
      go(r.id);
    } catch (e) {
      toast('error', `Não foi possível criar o teste: ${(e as Error).message}`);
      creating.current = false;
      setBusy(false);
    }
  };
  // `?idea=<id>` (link da tela Menções) abre os detalhes e os comentários desta ideia e a traz à vista.
  const [talk, setTalk] = useState(() => new URLSearchParams(location.search).get('idea') === i.id);
  const [more, setMore] = useState(talk);
  const self = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (talk) self.current?.scrollIntoView({ block: 'center' });
    // Só na primeira renderização.
  }, []);
  const moves = targets(i);
  return (
    <li
      ref={self}
      className="rounded-lg border border-gray-900/10 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]"
      data-testid="idea"
      data-stage={i.stage}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', i.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-display text-base leading-tight text-ink">{i.title}</h3>
        {i.score !== undefined && (
          <span
            className="tabular shrink-0 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-lime"
            title={`Impacto ${i.ice!.impact} · Confiança ${i.ice!.confidence} · Facilidade ${i.ice!.ease}`}
            data-testid="idea-score"
          >
            ICE {i.score.toLocaleString('pt-BR')}
          </span>
        )}
      </div>
      {(i.impact || i.effort) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {i.impact && <Tag label="impacto" value={i.impact} />}
          {i.effort && <Tag label="esforço" value={i.effort} />}
        </div>
      )}
      {i.page && (
        <p className="mt-1 truncate font-mono text-[11px] text-gray-500" title={i.page}>
          {i.page}
        </p>
      )}
      {i.hypothesis && <p className="mt-2 line-clamp-3 text-[13px] text-gray-700">{i.hypothesis}</p>}
      {i.experimentId && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
          {i.experimentStatus === 'deleted' ? (
            <span className="text-gray-400">Teste ligado foi excluído</span>
          ) : (
            <>
              <StatusBadge status={i.experimentStatus ?? 'draft'} />
              <button
                className="truncate text-left font-medium text-ink underline-offset-2 hover:underline"
                onClick={() => go(i.experimentId!)}
                data-testid="idea-open-test"
              >
                {i.experimentName ?? 'Abrir teste'}
              </button>
            </>
          )}
        </p>
      )}
      {i.stage === 'done' && (
        <div className="mt-2">
          <ResultLine i={i} />
        </div>
      )}
      {more && (
        <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          {i.change && (
            <>
              <dt className="label-mono">Mudança</dt>
              <dd className="text-gray-700">{i.change}</dd>
            </>
          )}
          {i.metric && (
            <>
              <dt className="label-mono">Meta</dt>
              <dd className="text-gray-700">{i.metric}</dd>
            </>
          )}
          {i.basedOn && (
            <>
              <dt className="label-mono">Por quê</dt>
              <dd className="text-gray-500">{i.basedOn}</dd>
            </>
          )}
        </dl>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {canEdit && !i.experimentId && (
          <Button size="sm" loading={busy} onClick={createTest} data-testid="idea-create-test">
            Criar teste
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={onPrioritize} data-testid="idea-prioritize">
            {i.ice ? 'ICE' : 'Priorizar'}
          </Button>
        )}
        {canEdit && moves.length > 0 && (
          <select
            aria-label={`Mover “${i.title}” para`}
            className={`${selectCls} py-0.5 text-xs`}
            value=""
            onChange={(e) =>
              e.target.value && onChange(ideas.update(i.id, { stage: e.target.value as IdeaStage }))
            }
            data-testid="idea-move"
          >
            <option value="">Mover…</option>
            {moves.map((s) => (
              <option key={s} value={s}>
                {STAGE[s].label}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMore(!more)}
          aria-expanded={more}
          data-testid="idea-more"
        >
          {more ? 'Menos' : 'Detalhes'}
        </Button>
      </div>
      {more && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} data-testid="idea-edit">
              <Pencil size={14} aria-hidden="true" /> Editar
            </Button>
          )}
          {canEdit &&
            (i.experimentId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(ideas.update(i.id, { experimentId: null }))}
                data-testid="idea-unlink"
              >
                <Unlink size={14} aria-hidden="true" /> Desligar teste
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onLink} data-testid="idea-link">
                <Link2 size={14} aria-hidden="true" /> Ligar a teste
              </Button>
            ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              copy(
                `${i.title}\nHipótese: ${i.hypothesis}\nMudança: ${i.change}\nMeta: ${i.metric}`,
                'Ideia copiada.',
              )
            }
          >
            <Copy size={14} aria-hidden="true" /> Copiar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTalk(!talk)}
            aria-expanded={talk}
            data-testid="idea-comments"
          >
            <MessageSquare size={14} aria-hidden="true" /> Comentários
          </Button>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-gray-500"
              onClick={() =>
                confirm(`Descartar a ideia “${i.title}”?`) ? onChange(ideas.remove(i.id)) : undefined
              }
              data-testid="idea-remove"
            >
              <Trash2 size={14} aria-hidden="true" /> Descartar
            </Button>
          )}
          <span className="label-mono w-full text-[10px] text-gray-400">
            {i.source === 'manual' ? `por ${i.createdBy ?? 'equipe'}` : SOURCE[i.source]?.(i.model)} ·{' '}
            {timeAgo(i.createdAt)}
            {i.stageAt ? ` · nesta coluna ${timeAgo(i.stageAt)}` : ''}
          </span>
        </div>
      )}
      {talk && (
        <div className="mt-3 border-t border-gray-900/[0.07] pt-3">
          <Comments targetType="idea" targetId={i.id} user={user} bare />
        </div>
      )}
    </li>
  );
}

const FIELDS: [keyof IdeaText, string, string][] = [
  ['hypothesis', 'Hipótese', 'Se mostrarmos o frete grátis no topo, mais visitantes vão comprar porque…'],
  ['change', 'Mudança', 'O que muda na página'],
  ['page', 'Página', '/carrinho, URL do site ou "todo o site"'],
  ['metric', 'Meta', 'Ex.: compra, clique no CTA'],
];

/** Criar ou editar o texto de uma ideia. */
function IdeaForm({
  idea,
  onClose,
  onSave,
}: {
  idea?: SavedIdea;
  onClose(): void;
  onSave(t: IdeaText): Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={idea ? 'Editar ideia' : 'Nova ideia'}
      testId="idea-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="idea-form" variant="primary" loading={busy} data-testid="idea-save">
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="idea-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = (k: string) => String(f.get(k) ?? '').trim();
          setBusy(true);
          try {
            const ok = await onSave({
              title: v('title'),
              hypothesis: v('hypothesis'),
              change: v('change'),
              page: v('page'),
              metric: v('metric'),
            });
            if (ok) onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Título</span>
          <input
            name="title"
            required
            maxLength={200}
            autoFocus
            defaultValue={idea?.title}
            placeholder="Ex.: Frete grátis no topo"
            className={inputCls}
            data-testid="idea-title"
          />
        </label>
        {FIELDS.map(([k, label, ph]) => (
          <label key={k} className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
            {k === 'hypothesis' || k === 'change' ? (
              <textarea
                name={k}
                rows={2}
                maxLength={2000}
                defaultValue={idea?.[k]}
                placeholder={ph}
                className={inputCls}
                data-testid={`idea-${k}`}
              />
            ) : (
              <input
                name={k}
                maxLength={k === 'page' ? 500 : 200}
                defaultValue={idea?.[k]}
                placeholder={ph}
                className={inputCls}
                data-testid={`idea-${k}`}
              />
            )}
          </label>
        ))}
      </form>
    </Modal>
  );
}

const ICE_FIELDS: [keyof Ice, string, string][] = [
  ['impact', 'Impacto', 'quanto move a meta se der certo'],
  ['confidence', 'Confiança', 'quanta evidência há (dados, pesquisas, testes parecidos)'],
  ['ease', 'Facilidade', '10 = trivial de fazer, 1 = muito esforço'],
];

/** Pontuação ICE (1–10 cada); score = média. */
function IceForm({
  idea,
  onClose,
  onSave,
}: {
  idea: SavedIdea;
  onClose(): void;
  onSave(ice: Ice | null): Promise<boolean>;
}) {
  const [ice, setIce] = useState<Ice>(() => suggestIce(idea));
  return (
    <Modal
      open
      onClose={onClose}
      title="Priorizar (ICE)"
      testId="ice-form"
      footer={
        <>
          {idea.ice && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => onSave(null).then((ok) => ok && onClose())}
            >
              Tirar pontuação
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(ice).then((ok) => ok && onClose())}
            data-testid="ice-save"
          >
            Salvar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-700">{idea.title}</p>
      <div className="space-y-3">
        {ICE_FIELDS.map(([k, label, help]) => (
          <label key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
            <span className="text-sm font-medium text-gray-700">
              {label} <span className="font-normal text-gray-500">· {help}</span>
            </span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              required
              value={ice[k]}
              onChange={(e) =>
                setIce({ ...ice, [k]: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))) })
              }
              className={`${inputCls} w-20 text-right`}
              data-testid={`ice-${k}`}
            />
          </label>
        ))}
      </div>
      <p className="mt-4 text-sm text-gray-700">
        Score ICE (média):{' '}
        <strong className="tabular text-ink" data-testid="ice-score">
          {iceScore(ice).toLocaleString('pt-BR')}
        </strong>
      </p>
    </Modal>
  );
}

/** Ligar a ideia a um teste que já existe. */
function LinkForm({
  idea,
  onClose,
  onSave,
}: {
  idea: SavedIdea;
  onClose(): void;
  onSave(id: string): Promise<boolean>;
}) {
  const { data } = useLoad(listExperiments, []);
  const [id, setId] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Ligar a teste"
      testId="link-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!id}
            onClick={() => onSave(id).then((ok) => ok && onClose())}
            data-testid="idea-link-save"
          >
            Ligar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-700">
        “{idea.title}” vai para <strong>Em teste</strong> e acompanha o status do teste: arquivado, vira
        concluída com o resultado.
      </p>
      {!data ? (
        <LoadingBlock rows={1} />
      ) : (
        <select
          aria-label="Teste"
          className={`${selectCls} w-full`}
          value={id}
          onChange={(e) => setId(e.target.value)}
          data-testid="idea-link-select"
        >
          <option value="">Escolha o teste…</option>
          {data.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
    </Modal>
  );
}

export function OptimizePage({ user }: { user: Me }) {
  const toast = useToast();
  const [days, setDays] = useState<Period>('30');
  const { data, setData } = useLoad(ideas.get, []);
  const running = data?.status === 'running';
  useEffect(() => {
    document.title = 'Otimização por IA · Experimenta';
  }, []);
  // A geração roda na API; aqui só acompanha. Sair da tela não interrompe nada.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (wasRunning.current && !running) {
      if (data.status === 'error') toast('error', data.error ?? 'A geração falhou.');
      else toast('success', 'Ideias prontas.');
    }
    wasRunning.current = running;
    if (!running) return;
    const t = setTimeout(() => ideas.get().then(setData, () => {}), 2500);
    return () => clearTimeout(t);
  }, [data, running, setData, toast]);
  /** Aplica a resposta da API; `false` = falhou (o aviso já apareceu e o modal fica aberto). */
  const change = (p: Promise<Ideas>) =>
    p.then(
      (d) => (setData(d), true),
      (e: Error) => (toast('error', e.message), false),
    );
  const canEdit = user.role !== 'viewer';
  // Modal aberto: nova ideia, editar, ICE ou ligar a teste.
  const [modal, setModal] = useState<{ kind: 'new' | 'edit' | 'ice' | 'link'; idea?: SavedIdea } | null>(
    null,
  );
  const [over, setOver] = useState<IdeaStage | null>(null);
  const drop = (stage: IdeaStage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const i = data?.ideas.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (!i || i.stage === stage) return;
    if (!targets(i).includes(stage))
      return toast(
        'error',
        linked(i)
          ? 'Com teste ligado, a ideia fica em “Em teste” ou “Concluídas”. Desligue o teste para voltar.'
          : 'Para ir para “Em teste”, crie ou ligue um teste.',
      );
    void change(ideas.update(i.id, { stage }));
  };
  const last = !data
    ? ''
    : running
      ? 'Gerando em segundo plano. Pode sair da tela: as ideias ficam salvas aqui.'
      : data.status === 'error'
        ? `A última geração falhou: ${data.error ?? ''}`
        : data.source
          ? (data.notice ?? `Última geração ${SOURCE[data.source]?.(data.model) ?? ''}`) +
            (data.finishedAt ? ` · ${timeAgo(data.finishedAt)}` : '')
          : '';
  return (
    <>
      <PageHeader
        eyebrow="Testes · IA"
        title="Otimização por IA"
        description="Backlog de hipóteses: ideias da IA (a partir do que o painel encontrou) e da equipe, priorizadas por ICE, ligadas ao teste e ao resultado. E um piloto automático que cuida da alocação."
        actions={<Segmented label="Período" value={days} onChange={setDays} options={PERIODS} />}
      />
      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <Button
              variant="primary"
              loading={running}
              disabled={!data}
              onClick={() => change(ideas.generate(Number(days)))}
              data-testid="ideas-run"
            >
              <Sparkles size={16} aria-hidden="true" />{' '}
              {running ? 'Gerando…' : data?.ideas.length ? 'Gerar mais ideias' : 'Gerar ideias'}
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setModal({ kind: 'new' })} disabled={!data} data-testid="idea-new">
              <Plus size={16} aria-hidden="true" /> Nova ideia
            </Button>
          )}
          <span className="label-mono" data-testid="ideas-source">
            {last}
          </span>
          {canEdit && !!data?.ideas.length && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() =>
                confirm('Limpar o backlog inteiro (todas as colunas)?') ? change(ideas.clear()) : undefined
              }
              data-testid="ideas-clear"
            >
              <Trash2 size={14} aria-hidden="true" /> Limpar tudo
            </Button>
          )}
        </div>
        {!data || (running && !data.ideas.length) ? (
          <LoadingBlock rows={4} />
        ) : !data.ideas.length ? (
          <EmptyState icon={<Sparkles size={20} aria-hidden="true" />} title="Backlog vazio">
            {data.status === 'done'
              ? 'Ainda não há achados suficientes no período. Colete mais dados, aumente o período ou escreva uma ideia.'
              : 'Gere ideias com IA (usam só números agregados do período; nenhum dado de visitante sai da conta) ou escreva as da equipe em “Nova ideia”.'}
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="ideas">
            {IDEA_STAGES.map((stage) => {
              const list = data.ideas.filter((i) => i.stage === stage).sort(byScore);
              return (
                <section
                  key={stage}
                  aria-labelledby={`stage-${stage}`}
                  className={`flex min-w-0 flex-col rounded-lg border p-2 transition-colors ${over === stage ? 'border-brand-500 bg-lime-soft/40' : 'border-gray-900/[0.07] bg-gray-50'}`}
                  data-testid={`stage-${stage}`}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setOver(stage);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={drop(stage)}
                >
                  <header className="flex items-baseline gap-2 px-1 pb-2">
                    <h2 id={`stage-${stage}`} className="text-sm font-semibold text-ink">
                      {STAGE[stage].label}
                    </h2>
                    <span className="tabular font-mono text-xs text-gray-500">{list.length}</span>
                    <span className="ml-auto truncate text-[11px] text-gray-400">{STAGE[stage].help}</span>
                  </header>
                  <ol className="space-y-2">
                    {list.map((i) => (
                      <IdeaCard
                        key={i.id}
                        i={i}
                        canEdit={canEdit}
                        user={user}
                        onChange={change}
                        onEdit={() => setModal({ kind: 'edit', idea: i })}
                        onPrioritize={() => setModal({ kind: 'ice', idea: i })}
                        onLink={() => setModal({ kind: 'link', idea: i })}
                      />
                    ))}
                  </ol>
                  {!list.length && <p className="px-1 py-6 text-center text-xs text-gray-400">Nada aqui.</p>}
                </section>
              );
            })}
          </div>
        )}
        <Card title="Piloto automático">
          <div className="space-y-2 text-sm text-gray-700">
            <p className="flex items-start gap-2">
              <Plane size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <span>
                Em Configurações do teste → Alocação, escolha <strong>Piloto automático</strong>: de hora em
                hora, mais tráfego para quem tem mais chance de vencer; perdedora sai do ar e não volta; com
                vencedora declarada, todo o tráfego novo vai para ela. Quem já viu uma variação continua nela.
              </span>
            </p>
          </div>
        </Card>
      </div>
      {modal?.kind === 'new' && (
        <IdeaForm onClose={() => setModal(null)} onSave={(t) => change(ideas.create(t))} />
      )}
      {modal?.kind === 'edit' && modal.idea && (
        <IdeaForm
          idea={modal.idea}
          onClose={() => setModal(null)}
          onSave={(t) => change(ideas.update(modal.idea!.id, t))}
        />
      )}
      {modal?.kind === 'ice' && modal.idea && (
        <IceForm
          idea={modal.idea}
          onClose={() => setModal(null)}
          onSave={(ice) => change(ideas.update(modal.idea!.id, { ice }))}
        />
      )}
      {modal?.kind === 'link' && modal.idea && (
        <LinkForm
          idea={modal.idea}
          onClose={() => setModal(null)}
          onSave={(experimentId) => change(ideas.update(modal.idea!.id, { experimentId }))}
        />
      )}
    </>
  );
}
