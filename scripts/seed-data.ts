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
  name: 'Home: chamada "Corra mais"',
  page: '/',
  segmentation: { urls: [url('exact', `${SITE}/`)] },
  variations: [
    { id: 'seed_v0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_v1',
      key: 'corra-mais',
      name: 'Corra mais',
      weight: 50,
      operations: [op('seed_op1', '#hero-title', 'Corra mais, canse menos')],
    },
  ],
  goals: [
    { id: 'seed_g_cta', key: 'clique-comprar', type: 'click', selector: '[data-testid=cta-comprar]' },
    { id: 'seed_g_buy', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'seed_g_thanks', key: 'obrigado', type: 'pageview', url: url('contains', '/obrigado') },
  ],
});
// 2) Produto: selo de frete grátis ajuda pouco (ainda inconclusivo).
const EXP_FRETE = await experiment({
  key: 'produto-frete-gratis',
  name: 'Produto: selo de frete grátis',
  page: '/produto.html',
  segmentation: { urls: [url('contains', '/produto')] },
  variations: [
    { id: 'seed_fr0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_fr1',
      key: 'selo-frete',
      name: 'Selo frete grátis',
      weight: 50,
      operations: [op('seed_op_fr', '#add-to-cart', 'Adicionar ao carrinho (frete grátis)')],
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

await entity('funnel', 'Compra pela home', {
  windowDays: 7,
  steps: [
    { type: 'url', name: 'Home', url: url('exact', `${SITE}/`) },
    { type: 'url', name: 'Produto', url: url('contains', '/produto') },
    { type: 'event', name: 'Compra', event: 'compra' },
    { type: 'url', name: 'Obrigado', url: url('contains', '/obrigado') },
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
  targeting: { urls: [url('contains', '/produto')], devices: [], audiences: [] },
  frequency: 'once',
  title: 'Antes de ir: 10% OFF',
  body: 'Use o cupom no checkout e ganhe 10% de desconto na primeira compra.',
  code: 'CORRA10',
  cta: { label: 'Usar cupom', url: '/produto.html#checkout' },
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
  targeting: { urls: [url('contains', '/obrigado')], devices: [], audiences: [] },
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
  ['[data-testid=cta-comprar]', 'cta'],
  ['[data-testid=cta-comprar]', 'cta'],
  ['#hero > img', 'img'],
  ['#hero-title', 'text'],
  ['body > header > nav > a:nth-of-type(2)', 'nav'],
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
      pv(`/${q}`, 'Loja Demo', firstRef);
      expose(EXP_HOME, 'home-cta-demo', hv, hk, '/');
      if (sampled) {
        for (let c = 0; c < between(0, 3); c++) {
          const [sel, w] = pick(CLICK_TARGETS);
          events.push({
            ...hb('/', { [EXP_HOME]: hv }),
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
              ...hb('/', { [EXP_HOME]: hv }),
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
            ...hb('/', { [EXP_HOME]: hv }),
            type: 'move',
            vw,
            points: Array.from({ length: 30 }, () => [
              +(0.15 + rand() * 0.5).toFixed(3),
              Math.round(80 + rand() ** 1.6 * 900),
            ]),
          });
      }
      scroll('/', 35 + rand() ** 0.7 * 70, { [EXP_HOME]: hv });
      if (!chance(armHome ? 0.45 : 0.31)) continue; // saiu da home
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/', 'seed_g_cta', 'clique-comprar');
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
    pv(`/produto.html${entry >= 0.88 ? q : ''}`, 'Produto · Loja Demo', entry < 0.38 ? `${SITE}/` : firstRef);
    expose(EXP_FRETE, 'produto-frete-gratis', fv, fk, '/produto.html');
    scroll('/produto.html', 40 + rand() ** 0.6 * 60, { [EXP_FRETE]: fv });
    const pBuy = (mobile ? 0.21 : 0.31) * (armFrete ? 1.02 : 1);
    const buys = chance(pBuy);
    // Checkout: quem compra envia; quem desiste para no CEP ou no cartão (mais no celular).
    const interacted = buys || chance(0.55);
    const stopAt = buys ? 99 : chance(0.15) ? 1 : chance(mobile ? 0.55 : 0.4) ? 3 : 4;
    const names = ['nome', 'email', 'cep', 'cartao', 'presente'];
    if (sampled || buys)
      events.push({
        ...hb('/produto.html', { [EXP_FRETE]: fv }),
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
          ...base('/produto.html'),
          type: 'engage',
          campaignId: POPUP,
          kind: 'popup',
          action: 'view',
        });
        events.push({
          ...base('/produto.html'),
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
      ...base('/produto.html'),
      type: 'event',
      name: 'compra',
      value,
      props: { sku: pick(['TN-1', 'TN-2', 'TN-3']) },
    });
    convert(EXP_FRETE, 'produto-frete-gratis', fv, fk, '/produto.html', 'seed_g_fr_buy', 'compra', value);
    if (entry < 0.38) {
      const hv = `seed_v${armHome}`;
      const hk = armHome ? 'corra-mais' : 'controle';
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/produto.html', 'seed_g_buy', 'compra', value);
      convert(EXP_HOME, 'home-cta-demo', hv, hk, '/obrigado.html', 'seed_g_thanks', 'obrigado');
    }
    pv('/obrigado.html', 'Obrigado · Loja Demo', `${SITE}/produto.html`);
    bought = true;
    // NPS pós-compra: a maioria vê, boa parte responde.
    if (chance(0.85)) {
      events.push({
        ...base('/obrigado.html'),
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
          ...base('/obrigado.html'),
          type: 'survey',
          surveyId: SURVEY,
          answers,
          completed: true,
        });
        events.push({
          ...base('/obrigado.html'),
          type: 'engage',
          campaignId: SURVEY,
          kind: 'survey',
          action: 'submit',
        });
      } else
        events.push({
          ...base('/obrigado.html'),
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
        ...base('/obrigado.html'),
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
            url: `${SITE}/`,
          };
          events.push({
            ...b2,
            eventId: randomUUID(),
            ts: later,
            type: 'pageview',
            device: other,
            title: 'Loja Demo',
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
