// Gera dados de demonstração realistas para a conta demo: 60 dias de visitantes navegando pelo site demo (home,
// produto, checkout, obrigado, loja), três experimentos com resultados diferentes, funis, pop-up, pesquisa NPS,
// recomendações, audiências, segmentos e flags. Os eventos vão pelo POST /collect, como o snippet faria; as
// campanhas são criadas pela API só se ainda não existirem (pelo nome/chave), então rodar de novo só soma tráfego.
// Uso: pnpm seed:data
//   API_URL (padrão http://localhost:4000), SITE_URL (padrão http://localhost:5180), EDITOR_ORIGIN,
//   SEED_EMAIL / SEED_PASSWORD (padrão demo@abtest.dev / demo1234), VISITORS (padrão 1500), DRY=1 só conta.
// ponytail: cada evento custa ~7 linhas escritas no D1 (tabela + índices); o plano grátis aceita 100 mil por dia,
// então em produção mantenha VISITORS por volta de 1500 por execução diária.
import { randomUUID } from 'node:crypto';
import { rng } from '../packages/shared/src/stats';

const API = process.env.API_URL ?? 'http://localhost:4000';
const SITE = (process.env.SITE_URL ?? 'http://localhost:5180').replace(/\/+$/, '');
const ORIGIN = process.env.EDITOR_ORIGIN ?? 'http://localhost:5173';
const DRY = !!process.env.DRY;
const VISITORS = Number(process.env.VISITORS ?? 1500);
const DAYS = 60;
const DAY = 86_400_000;

// PRNG com semente: os mesmos dados a cada execução (exceto ids). A semente 2 dá todos os achados do painel.
const rand = rng(Number(process.env.SEED ?? 2));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('origin', ORIGIN);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const r = await fetch(`${API}${path}`, { ...init, headers });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

const { token, user } = await call<{ token: string; user: { accountId: string } }>('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email: process.env.SEED_EMAIL ?? 'demo@abtest.dev',
    password: process.env.SEED_PASSWORD ?? 'demo1234',
  }),
});
const ACCOUNT = user.accountId;
const [project] = await call<{ id: string }[]>('/projects', { token });

// ---------- Campanhas (criadas uma vez) ----------

/** Cria a entidade se não houver uma com o mesmo nome; devolve o id. */
async function entity(kind: string, name: string, data: unknown): Promise<string> {
  const list = await call<{ id: string; name: string }[]>(`/entities/${kind}`, { token });
  const found = list.find((e) => e.name === name);
  if (found) return found.id;
  if (DRY) return `dry_${kind}`;
  return (
    await call<{ id: string }>(`/entities/${kind}`, {
      method: 'POST',
      token,
      body: JSON.stringify({ name, data }),
    })
  ).id;
}

const url = (match: 'exact' | 'contains', value: string) => ({ match, value, exclude: false });

/** Cria o experimento se a chave ainda não existe; devolve o id. */
async function experiment(e: { key: string; page: string } & Record<string, unknown>): Promise<string> {
  const list = await call<{ id: string; key: string }[]>('/experiments', { token });
  const found = list.find((x) => x.key === e.key);
  if (found) return found.id;
  const { page, ...rest } = e;
  const id = `exp_${randomUUID().slice(0, 8)}`;
  if (!DRY)
    await call('/experiments', {
      method: 'POST',
      token,
      body: JSON.stringify({
        projectId: project!.id,
        editorUrl: `${SITE}${page}`,
        experiment: { id, status: 'running', traffic: 100, ...rest },
      }),
    });
  return id;
}

const op = (id: string, selector: string, value: string) => ({
  id,
  type: 'setText',
  target: { selector, alternates: [] },
  value,
  order: 0,
});

// 1) Home: chamada nova ganha com folga no clique para comprar.
const EXP_HOME = await experiment({
  key: 'home-cta-demo',
  name: 'Loja: chamada "Corra mais"',
  page: '/loja/',
  segmentation: { urls: [url('exact', `${SITE}/loja/`)] },
  variations: [
    { id: 'seed_v0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_v1',
      key: 'corra-mais',
      name: 'Corra mais',
      weight: 50,
      operations: [
        op('seed_op1', '#hero-track > article:first-child .hero__text', 'Corra mais, canse menos'),
      ],
    },
  ],
  goals: [
    { id: 'seed_g_cta', key: 'clique-comprar', type: 'click', selector: '[data-testid=hero-cta]' },
    { id: 'seed_g_buy', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'seed_g_thanks', key: 'obrigado', type: 'pageview', url: url('contains', '/loja/obrigado') },
  ],
});
// 2) Checkout: selo de frete grátis ajuda pouco (ainda inconclusivo).
const EXP_FRETE = await experiment({
  key: 'produto-frete-gratis',
  name: 'Checkout: selo de frete grátis',
  page: '/loja/checkout.html',
  segmentation: { urls: [url('contains', '/loja/checkout')] },
  variations: [
    { id: 'seed_fr0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_fr1',
      key: 'selo-frete',
      name: 'Selo frete grátis',
      weight: 50,
      operations: [op('seed_op_fr', '#pay', 'Pagar agora (frete grátis)')],
    },
  ],
  goals: [{ id: 'seed_g_fr_buy', key: 'compra', type: 'custom', event: 'compra' }],
});
// 3) Loja: título com benefício converte melhor no celular e pior no desktop (achado por dispositivo).
const EXP_LOJA = await experiment({
  key: 'loja-titulo-beneficio',
  name: 'Loja: título com benefício',
  page: '/loja/',
  segmentation: { urls: [url('contains', '/loja')] },
  variations: [
    { id: 'seed_lj0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_lj1',
      key: 'beneficio',
      name: 'Benefício no título',
      weight: 50,
      operations: [op('seed_op_lj', '#hero-headline', 'Frete grátis e 30 dias para trocar')],
    },
  ],
  goals: [{ id: 'seed_g_lj_buy', key: 'compra-loja', type: 'custom', event: 'purchase' }],
});

await entity('funnel', 'Compra pela vitrine', {
  windowDays: 7,
  steps: [
    { type: 'url', name: 'Vitrine', url: url('exact', `${SITE}/loja/`) },
    { type: 'url', name: 'Checkout', url: url('contains', '/loja/checkout') },
    { type: 'event', name: 'Compra', event: 'compra' },
    { type: 'url', name: 'Obrigado', url: url('contains', '/loja/obrigado') },
  ],
});
await entity('funnel', 'Loja: vitrine até a compra', {
  windowDays: 7,
  steps: [
    { type: 'url', name: 'Loja', url: url('contains', '/loja') },
    { type: 'event', name: 'Viu produto', event: 'product_view' },
    { type: 'event', name: 'Comprou', event: 'purchase' },
  ],
});
const POPUP = await entity('popup', 'Cupom CORRA10 na saída', {
  status: 'running',
  format: 'modal',
  trigger: { type: 'exit' },
  targeting: { urls: [url('contains', '/loja/checkout')], devices: [], audiences: [] },
  frequency: 'once',
  title: 'Antes de ir: 10% OFF',
  body: 'Use o cupom no checkout e ganhe 10% de desconto na primeira compra.',
  code: 'CORRA10',
  cta: { label: 'Usar cupom', url: '/loja/checkout.html#checkout' },
  theme: 'brand',
  accent: '#16a34a',
});
const BAR = await entity('popup', 'Barra: frete grátis acima de R$ 299', {
  status: 'running',
  format: 'bar-top',
  trigger: { type: 'load' },
  targeting: { urls: [url('contains', '/loja')], devices: [], audiences: [] },
  frequency: 'session',
  title: 'Frete grátis acima de R$ 299',
  body: 'Para todo o Brasil, em até 7 dias úteis.',
  cta: { label: 'Ver tênis', url: '/loja/#produtos' },
  theme: 'dark',
  accent: '#16181d',
});
const NPS_Q = 'q_nps';
const WHY_Q = 'q_motivo';
const TEXT_Q = 'q_texto';
const SURVEY = await entity('survey', 'NPS pós-compra', {
  status: 'running',
  format: 'slide-in',
  trigger: { type: 'delay', seconds: 3 },
  targeting: { urls: [url('contains', '/loja/obrigado')], devices: [], audiences: [] },
  frequency: 'once',
  questions: [
    { id: NPS_Q, type: 'nps', text: 'De 0 a 10, quanto você recomendaria a Passo Firme a um amigo?' },
    {
      id: WHY_Q,
      type: 'choice',
      text: 'O que mais pesou na sua compra?',
      options: ['Preço', 'Frete', 'Variedade', 'Avaliações', 'Prazo de entrega'],
    },
    { id: TEXT_Q, type: 'text', text: 'Quer contar mais alguma coisa?', required: false },
  ],
  thankYou: 'Valeu! Sua resposta ajuda a melhorar a loja.',
  accent: '#16a34a',
});
const RECO = await entity('reco', 'Quem viu também viu (produto)', {
  status: 'running',
  strategy: 'coview',
  title: 'Quem viu este também viu',
  selector: '#produtos',
  position: 'after',
  limit: 4,
  targeting: { urls: [url('contains', '/loja')], devices: [], audiences: [] },
});
await entity('audience', 'Veio do Instagram', {
  match: 'all',
  rules: [{ type: 'referrer', op: 'contains', value: 'instagram' }],
});
await entity('audience', 'Recorrentes no celular', {
  match: 'all',
  rules: [
    { type: 'visitor', value: 'returning' },
    { type: 'device', value: 'mobile' },
  ],
});
await entity('segment', 'Compradores', { match: 'all', rules: [{ field: 'revenue', op: 'gte', value: 1 }] });
await entity('segment', 'Multi-dispositivo', {
  match: 'all',
  rules: [{ field: 'devices', op: 'gte', value: 2 }],
});
await entity('segment', 'Plano pro identificado', {
  match: 'all',
  rules: [
    { field: 'identified', value: true },
    { field: 'attribute', key: 'plano', op: 'eq', value: 'pro' },
  ],
});
await entity('flag', 'novo-checkout', {
  key: 'novo-checkout',
  description: 'Checkout em uma página só; liberado para 20% dos clientes',
  enabled: true,
  rollout: 20,
  rules: [],
  variables: { etapas: 1 },
});
await entity('flag', 'frete-expresso', {
  key: 'frete-expresso',
  description: 'Opção de entrega em 24 h nas capitais',
  enabled: false,
  rollout: 100,
  rules: [{ attribute: 'plano', op: 'eq', value: 'pro' }],
  variables: {},
});

// ---------- Fases 16–19 (criadas uma vez) ----------

// 17.1: dois testes da home num grupo mutuamente exclusivo (o visitante cai em no máximo um).
const EXP_GRP_CTA = await experiment({
  key: 'home-botao-urgencia',
  name: 'Loja: botão com urgência',
  hypothesis: 'Se o botão disser que o estoque é limitado, mais gente clica, porque cria urgência.',
  page: '/loja/',
  segmentation: { urls: [url('exact', `${SITE}/loja/`)] },
  variations: [
    { id: 'seed_gc0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_gc1',
      key: 'urgencia',
      name: 'Últimas unidades',
      weight: 50,
      operations: [op('seed_op_gc', '[data-testid=hero-cta]', 'Comprar: últimas unidades')],
    },
  ],
  goals: [{ id: 'seed_g_gc', key: 'clique-comprar', type: 'click', selector: '[data-testid=hero-cta]' }],
});
const EXP_GRP_NEWS = await experiment({
  key: 'home-newsletter-cupom',
  name: 'Loja: newsletter com cupom',
  page: '/loja/',
  segmentation: { urls: [url('exact', `${SITE}/loja/`)] },
  variations: [
    { id: 'seed_gn0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_gn1',
      key: 'cupom',
      name: 'Ganhe 10%',
      weight: 50,
      operations: [op('seed_op_gn', '#newsletter-form > button', 'Quero 10% OFF')],
    },
  ],
  goals: [{ id: 'seed_g_gn', key: 'newsletter', type: 'click', selector: '#newsletter-form > button' }],
});
await entity('group', 'Testes do topo da loja', {
  description: 'Os dois testes mexem na home: cada visitante vê no máximo um.',
  experiments: [
    { id: EXP_GRP_CTA, percent: 50 },
    { id: EXP_GRP_NEWS, percent: 50 },
  ],
});
// 17.2 + 17.5: teste multipágina (produto → obrigado) com sequencial, CUPED e meta de guarda.
const EXP_FUNIL = await experiment({
  key: 'funil-produto-obrigado',
  name: 'Funil: confiança do checkout ao obrigado',
  hypothesis: 'Reforçar troca grátis no produto e no pós-compra aumenta compras sem derrubar o NPS.',
  page: '/loja/checkout.html',
  pages: [
    {
      id: 'pg_prod',
      name: 'Produto',
      url: `${SITE}/loja/checkout.html`,
      match: url('contains', '/loja/checkout'),
    },
    {
      id: 'pg_obg',
      name: 'Obrigado',
      url: `${SITE}/loja/obrigado.html`,
      match: url('contains', '/loja/obrigado'),
    },
  ],
  stats: { sequential: true, cuped: true, guardrails: ['seed_g_fn_nl'] },
  variations: [
    { id: 'seed_fn0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_fn1',
      key: 'troca-gratis',
      name: 'Troca grátis em 30 dias',
      weight: 50,
      operations: [
        {
          ...op('seed_op_fn1', '#checkout-title', 'Finalize seu pedido · troca grátis em 30 dias'),
          page: 'pg_prod',
        },
        {
          ...op('seed_op_fn2', '#thanks-title', 'Pedido confirmado! Troca grátis em 30 dias.'),
          page: 'pg_obg',
        },
      ],
    },
  ],
  goals: [
    { id: 'seed_g_fn_buy', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'seed_g_fn_nl', key: 'obrigado', type: 'pageview', url: url('contains', '/loja/obrigado') },
  ],
});
// 17.4: rascunho com início agendado e o teste do frete com pausa agendada.
const EXP_DRAFT = await experiment({
  key: 'loja-black-friday',
  name: 'Loja: faixa de Black Friday',
  status: 'draft',
  page: '/loja/',
  segmentation: { urls: [url('contains', '/loja')] },
  variations: [
    { id: 'seed_bf0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_bf1',
      key: 'faixa',
      name: 'Faixa Black Friday',
      weight: 50,
      operations: [op('seed_op_bf', '#hero-headline', 'Black Friday: até 40% OFF em tênis de corrida')],
    },
  ],
  goals: [{ id: 'seed_g_bf', key: 'compra-loja', type: 'custom', event: 'purchase' }],
});

const iso = (ms: number) => new Date(ms).toISOString();
if (!DRY) {
  const schedules = await call<{ experimentId: string }[]>('/schedules', { token });
  if (!schedules.some((s) => s.experimentId === EXP_DRAFT))
    await call(`/experiments/${EXP_DRAFT}/schedules`, {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'start', at: iso(Date.now() + 33 * DAY) }),
    });
  if (!schedules.some((s) => s.experimentId === EXP_FRETE))
    await call(`/experiments/${EXP_FRETE}/schedules`, {
      method: 'POST',
      token,
      body: JSON.stringify({ action: 'pause', at: iso(Date.now() + 14 * DAY) }),
    });
  // 17.3: link de QA da variação do funil (7 dias).
  const previews = await call<unknown[]>(`/experiments/${EXP_FUNIL}/previews`, { token });
  if (!previews.length)
    await call(`/experiments/${EXP_FUNIL}/previews`, {
      method: 'POST',
      token,
      body: JSON.stringify({ variationId: 'seed_fn1', hours: 168 }),
    });
}

// 18.3: backlog de hipóteses em todas as colunas, uma ligada ao teste do funil.
if (!DRY) {
  type Idea = { id: string; title: string };
  let { ideas } = await call<{ ideas: Idea[] }>('/ai/ideas', { token });
  const BACKLOG = [
    {
      title: 'Tabela de medidas no produto',
      hypothesis: 'Quem não acha a tabela de medidas desiste; mostrá-la ao lado do preço reduz a dúvida.',
      change: 'Link "Qual meu número?" abaixo do preço abrindo a tabela.',
      page: '/loja/checkout.html',
      metric: 'compra',
    },
    {
      title: 'Selo de avaliações no topo da loja',
      hypothesis: 'Avaliações pesaram na compra (NPS); mostrar a nota média na vitrine aumenta a confiança.',
      change: 'Nota 4,8 ★ com 1.200 avaliações ao lado do título da loja.',
      page: '/loja/',
      metric: 'compra-loja',
      ice: { impact: 7, confidence: 6, ease: 8 },
    },
    {
      title: 'CEP antes do cartão no checkout',
      hypothesis: 'O campo CEP é onde mais gente trava; calcular o frete antes evita surpresa no fim.',
      change: 'Mover o CEP para o primeiro campo e mostrar o frete na hora.',
      page: '/loja/checkout.html',
      metric: 'compra',
      ice: { impact: 9, confidence: 7, ease: 5 },
    },
    {
      title: 'Troca grátis no funil',
      hypothesis: 'Reforçar a troca grátis no produto e no pós-compra aumenta compras sem derrubar o NPS.',
      change: 'Texto de troca grátis no título do produto e na página de obrigado.',
      page: '/loja/checkout.html',
      metric: 'compra',
      ice: { impact: 6, confidence: 6, ease: 9 },
      link: EXP_FUNIL,
    },
    {
      title: 'Chamada "Corra mais" na home',
      hypothesis: 'Um título com benefício direto aumenta o clique para comprar.',
      change: 'Trocar o título do herói por "Corra mais, canse menos".',
      page: '/loja/',
      metric: 'clique-comprar',
      ice: { impact: 6, confidence: 8, ease: 10 },
      link: EXP_HOME,
      stage: 'done' as const,
    },
  ];
  for (const { link, stage, ...b } of BACKLOG) {
    if (ideas.some((i) => i.title === b.title)) continue;
    const r = await call<{ id: string; ideas: Idea[] }>('/ai/ideas/manual', {
      method: 'POST',
      token,
      body: JSON.stringify(b),
    });
    ideas = r.ideas;
    if (link)
      await call(`/ai/ideas/${r.id}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ experimentId: link, ...(stage ? { stage } : {}) }),
      });
  }
}

// 19.1 + 19.4: integrações, webhooks (um que responde e um que falha, para a fila de reenvio) e exportação.
await entity('integrations', 'integrações', {
  ga4: true,
  gtm: true,
  segment: { enabled: true },
  mixpanel: { enabled: true, conversions: false },
  amplitude: { enabled: false },
});
await entity('consent', 'consentimento', { required: false, cmp: 'onetrust', category: '' });
await entity('webhook', 'Slack da equipe (exemplo)', {
  url: 'https://httpbin.org/post',
  events: ['publish', 'approval', 'mention'],
  enabled: true,
});
await entity('webhook', 'ERP fora do ar (exemplo de falha)', {
  url: 'https://httpbin.org/status/503',
  events: ['publish', 'approval'],
  enabled: true,
});
if (!DRY && !(await call<{ config: { enabled: boolean } }>('/exports', { token })).config.enabled) {
  await call('/integrations/crm', {
    method: 'PUT',
    token,
    body: JSON.stringify({
      hubspot: {
        enabled: false,
        fields: [
          { from: 'segments', to: 'abt_segments' },
          { from: 'revenue', to: 'abt_revenue' },
          { from: 'attr.plano', to: 'plano' },
        ],
      },
      salesforce: { enabled: false },
    }),
  });
  await call('/exports', {
    method: 'PUT',
    token,
    body: JSON.stringify({ enabled: true, events: true, reports: true, frequency: 'daily', hour: 3 }),
  });
}

// 16.2/16.3/16.4/16.6: equipe (convite pendente), comentários com menção e pedidos de aprovação do editor.
if (!DRY) {
  type Member = { id: string; name: string; email: string };
  const members = await call<Member[]>('/members', { token });
  const invites = await call<{ email: string }[]>('/invites', { token });
  if (!invites.some((i) => i.email === 'analista@passofirme.com.br'))
    await call('/invites', {
      method: 'POST',
      token,
      body: JSON.stringify({ email: 'analista@passofirme.com.br', role: 'editor' }),
    });
  const editorUser = members.find((m) => m.email === 'editor@abtest.dev');
  const owner = members.find((m) => m.email === (process.env.SEED_EMAIL ?? 'demo@abtest.dev'));
  const ed = editorUser
    ? (
        await call<{ token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'editor@abtest.dev',
            password: process.env.SEED_PASSWORD ?? 'demo1234',
          }),
        }).catch(() => null)
      )?.token
    : undefined;
  const comment = async (
    by: string,
    targetType: string,
    targetId: string,
    body: string,
    mentions: string[],
  ) => {
    const list = await call<{ body: string }[]>(
      `/comments?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
      { token },
    );
    if (!list.some((c) => c.body === body))
      await call('/comments', {
        method: 'POST',
        token: by,
        body: JSON.stringify({ targetType, targetId, body, mentions }),
      });
  };
  if (ed && owner && editorUser) {
    await comment(ed, 'experiment', EXP_FUNIL, `@${owner.name} subi a variação do funil, pode revisar?`, [
      owner.id,
    ]);
    await comment(token, 'experiment', EXP_FUNIL, `@${editorUser.name} revisei, ficou ótimo. Vou aprovar.`, [
      editorUser.id,
    ]);
    await comment(
      ed,
      'experiment',
      EXP_LOJA,
      'No desktop o título com benefício está perdendo, vale segmentar.',
      [],
    );
    await comment(ed, 'popup', POPUP, 'Cupom CORRA10 vence dia 30, trocar depois.', []);
    // Aprovação: a conta passa a exigir; um pedido aprovado (publica tudo acima) e outro pendente.
    const settings = await call<object>('/account/settings', { token });
    await call('/account/settings', {
      method: 'PUT',
      token,
      body: JSON.stringify({ ...settings, requireApproval: true }),
    });
    const reqs = await call<{ status: string; id: string }[]>('/publish-requests', { token });
    if (!reqs.length) {
      const first = await call<{ id: string }>('/publish-requests', {
        method: 'POST',
        token: ed,
        body: JSON.stringify({ note: 'Grupo da home, funil multipágina e ajustes do frete.' }),
      });
      await call(`/publish-requests/${first.id}/approve`, {
        method: 'POST',
        token,
        body: JSON.stringify({ comment: 'Aprovado, bom teste!' }),
      });
      await call('/publish-requests', {
        method: 'POST',
        token: ed,
        body: JSON.stringify({
          note: 'Agendei a faixa de Black Friday; publicar quando a arte estiver pronta.',
        }),
      });
    }
  }
}

// ---------- Tráfego ----------

const events: Record<string, unknown>[] = [];
const now = Date.now();
const DEVICES = [
  ['desktop', 1440, 0.45],
  ['mobile', 390, 0.48],
  ['tablet', 820, 0.07],
] as const;
/** Alvos de clique na home (seletor, tipo). A imagem do herói não é clicável: gera dead/rage clicks. */
const CLICK_TARGETS = [
  ['[data-testid=hero-cta]', 'cta'],
  ['[data-testid=hero-cta]', 'cta'],
  ['#hero-headline', 'img'],
  ['#hero-track > article:first-child .hero__text', 'text'],
  ['.mainnav__item:nth-of-type(2) > a', 'nav'],
  ['#newsletter-form > button', 'form'],
] as const;
/** Catálogo da loja demo (apps/demo/loja/loja.js). */
const STORE = [
  { id: 1, name: 'Runner X Nuvem 2', price: 599.9, category: 'corrida' },
  { id: 2, name: 'Trail Grip Pro', price: 689.9, category: 'corrida' },
  { id: 3, name: 'Urban Flex', price: 399.9, category: 'casual' },
  { id: 4, name: 'Maratona Elite', price: 999.9, category: 'corrida' },
  { id: 5, name: 'Skate Classic', price: 299.9, category: 'casual' },
  { id: 6, name: 'Meia Compressão (3 pares)', price: 89.9, category: 'acessorios' },
  { id: 7, name: 'Garrafa Térmica 750 ml', price: 129.9, category: 'acessorios' },
  { id: 8, name: 'Runner Kids', price: 249.9, category: 'corrida' },
];
/** Origem da 1ª visita: busca, redes, campanhas com UTM e acesso direto. */
const SOURCES = [
  ['https://www.google.com/', ''],
  ['https://www.google.com/', ''],
  ['https://www.google.com/', '?utm_source=google&utm_medium=cpc&utm_campaign=tenis-corrida'],
  ['https://www.instagram.com/', '?utm_source=instagram&utm_medium=social&utm_campaign=semana-do-corredor'],
  ['https://www.instagram.com/', ''],
  ['https://www.facebook.com/', '?utm_source=facebook&utm_medium=social'],
  ['https://mail.google.com/', '?utm_source=newsletter&utm_medium=email&utm_campaign=outubro'],
  ['', ''],
  ['', ''],
] as const;
const COMMENTS = [
  'Entrega chegou antes do prazo, muito bom.',
  'O tamanho ficou certinho, recomendo pedir o número de sempre.',
  'Achei o frete caro para o interior.',
  'Site fácil de usar, comprei pelo celular sem problema.',
  'Demorei para achar a tabela de medidas.',
  'Preço bom comparado com as outras lojas.',
  'Queria mais opções de cor no Runner X.',
  'O cupom não aplicou de primeira, tive que digitar de novo.',
  'Atendimento respondeu rápido no WhatsApp.',
  'Gostei das avaliações dos clientes, ajudaram a decidir.',
];

/** Dia da visita: tráfego cresce ao longo dos 60 dias e cai no fim de semana. */
function visitDay(): number {
  for (;;) {
    const d = Math.floor(rand() * DAYS); // 0 = hoje
    const weekday = new Date(now - d * DAY).getDay();
    const w = (1 - (d / DAYS) * 0.3) * (weekday === 0 || weekday === 6 ? 0.7 : 1);
    if (rand() < w) return d;
  }
}
/** Hora do dia com picos no almoço e à noite. */
const hour = () => pick([8, 9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 18, 19, 20, 20, 21, 21, 22, 23]);

for (let i = 0; i < VISITORS; i++) {
  const visitorId = randomUUID();
  const r = rand();
  const [device, vw] =
    r < DEVICES[0][2] ? DEVICES[0] : r < DEVICES[0][2] + DEVICES[1][2] ? DEVICES[1] : DEVICES[2];
  const mobile = device === 'mobile';
  const armHome = chance(0.5) ? 0 : 1;
  const armFrete = chance(0.5) ? 0 : 1;
  const armLoja = chance(0.5) ? 0 : 1;
  const sessions = chance(0.28) ? between(2, 4) : 1;
  const [ref, utm] = pick(SOURCES);
  const d0 = visitDay();
  let t = now - d0 * DAY;
  t = t - (t % DAY) + hour() * 3_600_000 + Math.floor(rand() * 3_600_000) - 3 * 3_600_000; // horário de Brasília
  if (t > now) t = now - Math.floor(rand() * 3_600_000);
  let bought = false;
  let identified: string | null = null;

  for (let s = 0; s < sessions && t < now; s++) {
    const sessionId = randomUUID();
    // Amostra de captura de comportamento (mapa de calor, scroll, frustração): metade das sessões.
    const sampled = chance(0.5);
    const base = (path: string) => ({
      eventId: randomUUID(),
      ts: t,
      accountId: ACCOUNT,
      visitorId,
      sessionId,
      url: SITE + path,
    });
    const hb = (path: string, variations: Record<string, string> = {}) => ({
      ...base(path),
      device,
      variations,
    });
    const pv = (path: string, title: string, referrer?: string) => {
      events.push({ ...base(path), type: 'pageview', device, title, vw, ...(referrer ? { referrer } : {}) });
      t += 4_000 + Math.floor(rand() * 50_000);
    };
    const expose = (expId: string, key: string, vid: string, vkey: string, path: string) =>
      events.push({
        ...base(path),
        type: 'exposure',
        experimentId: expId,
        experimentKey: key,
        variationId: vid,
        variationKey: vkey,
      });
    const convert = (
      expId: string,
      key: string,
      vid: string,
      vkey: string,
      path: string,
      goal: string,
      goalKey: string,
      value?: number,
    ) =>
      events.push({
        ...base(path),
        type: 'conversion',
        experimentId: expId,
        experimentKey: key,
        variationId: vid,
        variationKey: vkey,
        goalId: goal,
        goalKey,
        ...(value ? { value } : {}),
      });
    const scroll = (path: string, depth: number, variations?: Record<string, string>) =>
      sampled &&
      events.push({
        ...hb(path, variations),
        type: 'scroll',
        depth: Math.round(Math.min(100, depth)),
        vh: 800,
        ph: 2400,
      });

    // Entrada: 38% pela home, metade direto na loja (campanhas), o resto no produto.
    const entry = s === 0 ? rand() : rand() * 0.8;
    // Volta: 45% por outro canal (e-mail, anúncio, busca...) e o resto direto, para a receita por canal
    // mostrar primeiro e último toque diferentes.
    const [sRef, sUtm] = s === 0 ? [ref, utm] : chance(0.45) ? pick(SOURCES) : ['', ''];
    const firstRef = sRef || undefined;
    const q = sUtm;

    if (entry < 0.38) {
      // ----- Home → produto → checkout → obrigado -----
      const hv = `seed_v${armHome}`;
      const hk = armHome ? 'corra-mais' : 'controle';
      pv(`/loja/${q}`, 'Passo Firme · Tênis e acessórios para correr', firstRef);
      expose(EXP_HOME, 'home-cta-demo', hv, hk, '/loja/');
      if (sampled) {
        for (let c = 0; c < between(0, 3); c++) {
          const [sel, w] = pick(CLICK_TARGETS);
          events.push({
            ...hb('/loja/', { [EXP_HOME]: hv }),
            type: 'click',
            selector: sel,
            rx: +(0.2 + rand() * 0.6).toFixed(3),
            ry: +(0.2 + rand() * 0.6).toFixed(3),
            px: 0,
            py: 0,
            vw,
            vh: 800,
          });
          if (w === 'img' && chance(0.65))
            events.push({
              ...hb('/loja/', { [EXP_HOME]: hv }),
              type: 'frustration',
              kind: chance(0.45) ? 'rage' : 'dead',
              selector: sel,
              rx: +rand().toFixed(3),
              ry: +rand().toFixed(3),
              count: 1,
            });
        }
        if (chance(0.35))
          events.push({
            ...hb('/loja/', { [EXP_HOME]: hv }),
            type: 'move',
            vw,
            points: Array.from({ length: 30 }, () => [
              +(0.15 + rand() * 0.5).toFixed(3),
              Math.round(80 + rand() ** 1.6 * 900),
            ]),
          });
      }
      scroll('/loja/', 35 + rand() ** 0.7 * 70, { [EXP_HOME]: hv });
      if (!chance(armHome ? 0.45 : 0.31)) continue; // saiu da home
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/loja/', 'seed_g_cta', 'clique-comprar');
    } else if (entry < 0.88) {
      // ----- Loja completa (vitrine, produtos, compra) -----
      const lv = `seed_lj${armLoja}`;
      const lk = armLoja ? 'beneficio' : 'controle';
      pv(`/loja/${q}`, 'Passo Firme · Tênis e acessórios para correr', firstRef);
      expose(EXP_LOJA, 'loja-titulo-beneficio', lv, lk, '/loja/');
      if (s === 0)
        events.push({ ...base('/loja/'), type: 'engage', campaignId: BAR, kind: 'popup', action: 'view' });
      if (s === 0 && chance(0.06))
        events.push({ ...base('/loja/'), type: 'engage', campaignId: BAR, kind: 'popup', action: 'click' });
      scroll('/loja/', 25 + rand() ** 0.9 * 75, { [EXP_LOJA]: lv });
      const cat = pick(['corrida', 'corrida', 'corrida', 'casual', 'acessorios']);
      const pool = STORE.filter((p) => p.category === cat || chance(0.2));
      const seen: number[] = [];
      for (let k = 0; k < between(0, 4); k++) {
        const p = pick(pool);
        if (seen.includes(p.id)) continue;
        seen.push(p.id);
        events.push({
          ...base('/loja/'),
          type: 'event',
          name: 'product_view',
          props: { ...p, url: `/loja/#produto-${p.id}` },
        });
        t += 4_000 + Math.floor(rand() * 20_000);
      }
      if (seen.length)
        events.push({ ...base('/loja/'), type: 'engage', campaignId: RECO, kind: 'reco', action: 'view' });
      // Benefício no título: ajuda no celular, atrapalha um pouco no desktop.
      const pBuy = (mobile ? 0.13 : 0.15) * (armLoja ? (mobile ? 1.6 : 0.25) : 1);
      if (seen.length && chance(pBuy)) {
        const ids = [seen[0]!, ...(cat === 'corrida' && chance(0.6) ? [pick([6, 7])] : [])];
        const value = +ids.reduce((sum, id) => sum + STORE.find((p) => p.id === id)!.price, 0).toFixed(2);
        events.push({
          ...base('/loja/'),
          type: 'event',
          name: 'purchase',
          value,
          props: { ids: ids.join(',') },
        });
        convert(EXP_LOJA, 'loja-titulo-beneficio', lv, lk, '/loja/', 'seed_g_lj_buy', 'compra-loja', value);
        bought = true;
      }
      t += Math.round(DAY * (1 + rand() * 6));
      continue;
    }

    // ----- Produto + checkout -----
    const fv = `seed_fr${armFrete}`;
    const fk = armFrete ? 'selo-frete' : 'controle';
    pv(
      `/loja/checkout.html${entry >= 0.88 ? q : ''}`,
      'Checkout · Passo Firme',
      entry < 0.38 ? `${SITE}/loja/` : firstRef,
    );
    expose(EXP_FRETE, 'produto-frete-gratis', fv, fk, '/loja/checkout.html');
    scroll('/loja/checkout.html', 40 + rand() ** 0.6 * 60, { [EXP_FRETE]: fv });
    const pBuy = (mobile ? 0.21 : 0.31) * (armFrete ? 1.02 : 1);
    const buys = chance(pBuy);
    // Checkout: quem compra envia; quem desiste para no CEP ou no cartão (mais no celular).
    const interacted = buys || chance(0.55);
    const stopAt = buys ? 99 : chance(0.15) ? 1 : chance(mobile ? 0.55 : 0.4) ? 3 : 4;
    const names = ['nome', 'email', 'cep', 'cartao', 'presente'];
    if (sampled || buys)
      events.push({
        ...hb('/loja/checkout.html', { [EXP_FRETE]: fv }),
        type: 'form',
        form: '#checkout',
        interacted,
        submitted: buys,
        ...(interacted && !buys ? { lastField: names[stopAt - 1] } : {}),
        fields: names.map((name, k) => {
          const reached = interacted && k < stopAt && name !== 'presente';
          const slow = name === 'cep' ? 2.4 : name === 'cartao' ? 3.1 : 1;
          return {
            name,
            kind: name === 'email' ? 'email' : name === 'presente' ? 'checkbox' : 'text',
            time: reached ? Math.round((1500 + rand() * 4000) * slow * (mobile ? 1.4 : 1)) : 0,
            ...(reached ? { hesitation: Math.round(200 + rand() * 900 * slow) } : {}),
            focus: reached ? 1 + (chance(0.2) ? 1 : 0) : 0,
            refills: reached && name === 'cep' && chance(0.35) ? 1 : 0,
            filled: reached && (k < stopAt - 1 || buys),
          };
        }),
      });
    if (!buys) {
      // Intenção de saída no produto: pop-up de cupom (uma vez por visitante, só no desktop dispara de verdade).
      if (s === 0 && chance(mobile ? 0.25 : 0.6)) {
        events.push({
          ...base('/loja/checkout.html'),
          type: 'engage',
          campaignId: POPUP,
          kind: 'popup',
          action: 'view',
        });
        events.push({
          ...base('/loja/checkout.html'),
          type: 'engage',
          campaignId: POPUP,
          kind: 'popup',
          action: chance(0.14) ? 'click' : 'close',
        });
      }
      t += Math.round(DAY * (1 + rand() * 6));
      continue;
    }
    const value = pick([249.9, 299.9, 399.9, 599.9, 599.9, 689.9, 999.9]);
    events.push({
      ...base('/loja/checkout.html'),
      type: 'event',
      name: 'compra',
      value,
      props: { sku: pick(['TN-1', 'TN-2', 'TN-3']) },
    });
    convert(
      EXP_FRETE,
      'produto-frete-gratis',
      fv,
      fk,
      '/loja/checkout.html',
      'seed_g_fr_buy',
      'compra',
      value,
    );
    if (entry < 0.38) {
      const hv = `seed_v${armHome}`;
      const hk = armHome ? 'corra-mais' : 'controle';
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/loja/checkout.html', 'seed_g_buy', 'compra', value);
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/loja/obrigado.html', 'seed_g_thanks', 'obrigado');
    }
    pv('/loja/obrigado.html', 'Pedido confirmado · Passo Firme', `${SITE}/loja/checkout.html`);
    bought = true;
    // NPS pós-compra: a maioria vê, boa parte responde.
    if (chance(0.85)) {
      events.push({
        ...base('/loja/obrigado.html'),
        type: 'engage',
        campaignId: SURVEY,
        kind: 'survey',
        action: 'view',
      });
      if (chance(0.55)) {
        const r2 = rand();
        const nps = r2 < 0.56 ? between(9, 10) : r2 < 0.8 ? between(7, 8) : between(2, 6);
        const answers: { questionId: string; value: number | string }[] = [
          { questionId: NPS_Q, value: nps },
          {
            questionId: WHY_Q,
            value: pick(['Preço', 'Preço', 'Frete', 'Variedade', 'Avaliações', 'Prazo de entrega']),
          },
        ];
        if (chance(0.3)) answers.push({ questionId: TEXT_Q, value: pick(COMMENTS) });
        events.push({
          ...base('/loja/obrigado.html'),
          type: 'survey',
          surveyId: SURVEY,
          answers,
          completed: true,
        });
        events.push({
          ...base('/loja/obrigado.html'),
          type: 'engage',
          campaignId: SURVEY,
          kind: 'survey',
          action: 'submit',
        });
      } else
        events.push({
          ...base('/loja/obrigado.html'),
          type: 'engage',
          campaignId: SURVEY,
          kind: 'survey',
          action: 'close',
        });
    }
    // Quem compra costuma criar conta: identify (e parte volta por outro dispositivo).
    if (!identified && chance(0.6)) {
      identified = `cliente-${1000 + i}`;
      events.push({
        ...base('/loja/obrigado.html'),
        type: 'identify',
        userId: identified,
        attrs: {
          plano: chance(0.25) ? 'pro' : 'free',
          cidade: pick([
            'São Paulo',
            'Rio de Janeiro',
            'Belo Horizonte',
            'Curitiba',
            'Recife',
            'Porto Alegre',
          ]),
        },
      });
      if (chance(0.35)) {
        const later = t + Math.round(DAY * (0.5 + rand() * 3));
        if (later < now) {
          const other = mobile ? 'desktop' : 'mobile';
          const b2 = {
            accountId: ACCOUNT,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            url: `${SITE}/loja/`,
          };
          events.push({
            ...b2,
            eventId: randomUUID(),
            ts: later,
            type: 'pageview',
            device: other,
            title: 'Passo Firme · Tênis e acessórios para correr',
            vw: other === 'mobile' ? 390 : 1440,
          });
          events.push({
            ...b2,
            eventId: randomUUID(),
            ts: later + 6_000,
            type: 'identify',
            userId: identified,
            attrs: { ultimo_dispositivo: other },
          });
        }
      }
    }
    t += Math.round(DAY * (2 + rand() * 8));
  }
  void bought;
}

// Tráfego dos testes das fases 16–19 (depois do laço principal: não muda a sequência da semente acima).
// Grupo da home: fatia 0–49 vai para o botão, 50–99 para a newsletter. Funil: só os últimos 30 dias.
for (let i = 0; i < Math.round(VISITORS / 2); i++) {
  const visitorId = randomUUID();
  const sessionId = randomUUID();
  const d = Math.floor(rand() * 30);
  let t = now - d * DAY - Math.floor(rand() * DAY);
  const base = (path: string) => ({
    eventId: randomUUID(),
    ts: (t += 3_000),
    accountId: ACCOUNT,
    visitorId,
    sessionId,
    url: SITE + path,
  });
  const arm = chance(0.5) ? 1 : 0;
  const pair = (exp: string, key: string, prefix: string, vkey: string, path: string) => ({
    experimentId: exp,
    experimentKey: key,
    variationId: `${prefix}${arm}`,
    variationKey: arm ? vkey : 'controle',
    ...base(path),
  });
  if (chance(0.5)) {
    const [exp, key, prefix, vkey, goal, gkey, p] = chance(0.5)
      ? [
          EXP_GRP_CTA,
          'home-botao-urgencia',
          'seed_gc',
          'urgencia',
          'seed_g_gc',
          'clique-comprar',
          arm ? 0.36 : 0.3,
        ]
      : [
          EXP_GRP_NEWS,
          'home-newsletter-cupom',
          'seed_gn',
          'cupom',
          'seed_g_gn',
          'newsletter',
          arm ? 0.11 : 0.06,
        ];
    events.push({ ...pair(exp, key, prefix, vkey, '/loja/'), type: 'exposure' });
    if (chance(p))
      events.push({
        ...pair(exp, key, prefix, vkey, '/loja/'),
        type: 'conversion',
        goalId: goal,
        goalKey: gkey,
      });
  } else {
    events.push({
      ...pair(EXP_FUNIL, 'funil-produto-obrigado', 'seed_fn', 'troca-gratis', '/loja/checkout.html'),
      type: 'exposure',
    });
    if (chance(arm ? 0.3 : 0.26)) {
      const value = pick([299.9, 399.9, 599.9, 689.9]);
      const c = (path: string, goalId: string, goalKey: string, v?: number) =>
        events.push({
          ...pair(EXP_FUNIL, 'funil-produto-obrigado', 'seed_fn', 'troca-gratis', path),
          type: 'conversion',
          goalId,
          goalKey,
          ...(v ? { value: v } : {}),
        });
      c('/loja/checkout.html', 'seed_g_fn_buy', 'compra', value);
      c('/loja/obrigado.html', 'seed_g_fn_nl', 'obrigado');
    }
  }
}

events.sort((a, b) => (a.ts as number) - (b.ts as number));
const counts: Record<string, number> = {};
for (const e of events) counts[e.type as string] = (counts[e.type as string] ?? 0) + 1;
if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(events));
if (!DRY) {
  for (let i = 0; i < events.length; i += 60)
    await call('/collect', { method: 'POST', body: JSON.stringify({ events: events.slice(i, i + 60) }) });
  await call('/recommendations/rebuild', { method: 'POST', token });
}
console.log(
  `[seed:data] ${VISITORS} visitantes, ${events.length} eventos ${DRY ? '(DRY, nada enviado)' : `enviados para ${API}`}:`,
  counts,
);
