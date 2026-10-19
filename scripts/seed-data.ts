// Gera tráfego de demonstração para a conta demo (dev): visitantes ao longo de 30 dias navegando pelo site demo,
// eventos, um experimento com resultado e as capturas dos módulos de insights. Envia pelo POST /collect, como o
// snippet faria. Uso: pnpm seed:data  (API em http://localhost:4000; API_URL e VISITORS sobrescrevem)
import { randomUUID } from 'node:crypto';
import { rng } from '../packages/shared/src/stats';

const API = process.env.API_URL ?? 'http://localhost:4000';
const DRY = !!process.env.DRY;
const SITE = process.env.SITE_URL ?? 'http://localhost:5180';
const VISITORS = Number(process.env.VISITORS ?? 1500);
const DAY = 86_400_000;

// PRNG com semente: os mesmos dados a cada execução (exceto ids).

const rand = rng(1234);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('origin', 'http://localhost:5173');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const r = await fetch(`${API}${path}`, { ...init, headers });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

const { token } = await call<{ token: string }>('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'demo@abtest.dev', password: 'demo1234' }),
});
const [project] = await call<{ id: string }[]>('/projects', { token });

// Experimento da home (cria uma vez; reaproveita pela chave).
const KEY = 'home-cta-demo';
const list = await call<{ id: string; key: string }[]>('/experiments', { token });
let expId = list.find((e) => e.key === KEY)?.id;
const experiment = {
  id: expId ?? `exp_${randomUUID().slice(0, 8)}`,
  key: KEY,
  name: 'Home: chamada "Corra mais"',
  status: 'running',
  traffic: 100,
  segmentation: { urls: [{ match: 'exact', value: `${SITE}/`, exclude: false }] },
  variations: [
    { id: 'seed_v0', key: 'controle', name: 'Controle', weight: 50 },
    {
      id: 'seed_v1',
      key: 'corra-mais',
      name: 'Corra mais',
      weight: 50,
      operations: [
        {
          id: 'seed_op1',
          type: 'setText',
          target: { selector: '#hero-title', alternates: [] },
          value: 'Corra mais',
          order: 0,
        },
      ],
    },
  ],
  goals: [
    { id: 'seed_g_buy', key: 'compra', type: 'custom', event: 'compra' },
    { id: 'seed_g_cta', key: 'clique-comprar', type: 'click', selector: '[data-testid=cta-comprar]' },
    {
      id: 'seed_g_thanks',
      key: 'obrigado',
      type: 'pageview',
      url: { match: 'contains', value: '/obrigado', exclude: false },
    },
  ],
};
if (!expId) {
  await call('/experiments', {
    method: 'POST',
    token,
    body: JSON.stringify({ projectId: project!.id, editorUrl: `${SITE}/`, experiment }),
  });
  expId = experiment.id;
}

const events: Record<string, unknown>[] = [];
const now = Date.now();
const DEVICES = [
  ['desktop', 1440, 0.55],
  ['mobile', 390, 0.38],
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
const REFERRERS = ['https://www.google.com/', 'https://www.instagram.com/', 'https://t.co/x', '', '', ''];

for (let i = 0; i < VISITORS; i++) {
  const visitorId = randomUUID();
  const r = rand();
  const [device, vw] =
    r < DEVICES[0][2] ? DEVICES[0] : r < DEVICES[0][2] + DEVICES[1][2] ? DEVICES[1] : DEVICES[2];
  const arm = chance(0.5) ? 0 : 1;
  const sessions = chance(0.3) ? 2 + Math.floor(rand() * 3) : 1;
  let t = now - Math.floor(rand() * 30 * DAY);
  for (let s = 0; s < sessions && t < now; s++) {
    const sessionId = randomUUID();
    const base = (url: string) => ({
      eventId: randomUUID(),
      ts: t,
      accountId: 'demo',
      visitorId,
      sessionId,
      url,
    });
    const pv = (path: string, title: string, referrer?: string) => {
      events.push({
        ...base(SITE + path),
        type: 'pageview',
        device,
        title,
        vw,
        ...(referrer ? { referrer } : {}),
      });
      t += 5_000 + Math.floor(rand() * 60_000);
    };
    pv('/', 'Loja Demo', s === 0 ? pick(REFERRERS) : undefined);
    // Comportamento na home (todos amostrados no dev): cliques, frustração, movimento e scroll.
    const hb = { ...base(`${SITE}/`), device, variations: { [expId!]: `seed_v${arm}` } };
    const clicks = Math.floor(rand() * 4);
    for (let c = 0; c < clicks; c++) {
      const [sel, w] = pick(CLICK_TARGETS);
      events.push({
        ...hb,
        eventId: randomUUID(),
        type: 'click',
        selector: sel,
        rx: +(0.2 + rand() * 0.6).toFixed(3),
        ry: +(0.2 + rand() * 0.6).toFixed(3),
        px: 0,
        py: 0,
        vw,
        vh: 800,
      });
      if (w === 'img' && chance(0.35))
        events.push({
          ...hb,
          eventId: randomUUID(),
          type: 'frustration',
          kind: chance(0.3) ? 'rage' : 'dead',
          selector: sel,
          rx: +rand().toFixed(3),
          ry: +rand().toFixed(3),
          count: 1,
        });
    }
    events.push({
      ...hb,
      eventId: randomUUID(),
      type: 'move',
      vw,
      points: Array.from({ length: 30 }, () => [
        +(0.15 + rand() * 0.5).toFixed(3),
        Math.round(80 + rand() ** 1.6 * 900),
      ]),
    });
    events.push({
      ...hb,
      eventId: randomUUID(),
      type: 'scroll',
      depth: Math.round(Math.min(100, 35 + rand() ** 0.7 * 70)),
      vh: 800,
      ph: 1600,
    });
    events.push({
      ...base(`${SITE}/`),
      type: 'exposure',
      experimentId: expId,
      experimentKey: KEY,
      variationId: `seed_v${arm}`,
      variationKey: arm ? 'corra-mais' : 'controle',
    });
    const exp = (goal: string, key: string, value?: number) =>
      events.push({
        ...base(`${SITE}/`),
        type: 'conversion',
        experimentId: expId,
        experimentKey: KEY,
        variationId: `seed_v${arm}`,
        variationKey: arm ? 'corra-mais' : 'controle',
        goalId: goal,
        goalKey: key,
        ...(value ? { value } : {}),
      });
    // Funil: home → produto → obrigado. A variação melhora o clique no CTA.
    if (chance(arm ? 0.42 : 0.34)) {
      exp('seed_g_cta', 'clique-comprar');
      pv('/produto.html', 'Tênis — Loja Demo', `${SITE}/`);
      const buys = chance(device === 'mobile' ? 0.22 : 0.33);
      // Checkout: quem compra envia; quem desiste para no CEP ou no cartão (mais no celular).
      const interacted = buys || chance(0.55);
      const stopAt = buys ? 99 : chance(0.15) ? 1 : chance(0.45) ? 3 : 4;
      const names = ['nome', 'email', 'cep', 'cartao', 'presente'];
      events.push({
        ...base(`${SITE}/produto.html`),
        type: 'form',
        device,
        variations: {},
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
            time: reached ? Math.round((1500 + rand() * 4000) * slow * (device === 'mobile' ? 1.4 : 1)) : 0,
            ...(reached ? { hesitation: Math.round(200 + rand() * 900 * slow) } : {}),
            focus: reached ? 1 + (chance(0.2) ? 1 : 0) : 0,
            refills: reached && name === 'cep' && chance(0.35) ? 1 : 0,
            filled: reached && (k < stopAt - 1 || buys),
          };
        }),
      });
      if (buys) {
        const value = pick([199, 299, 349, 449]);
        events.push({
          ...base(`${SITE}/produto.html`),
          type: 'event',
          name: 'compra',
          value,
          props: { sku: pick(['TN-1', 'TN-2', 'TN-3']) },
        });
        exp('seed_g_buy', 'compra', value);
        pv('/obrigado.html', 'Obrigado!', `${SITE}/produto.html`);
        exp('seed_g_thanks', 'obrigado');
      }
    } else if (chance(0.3)) pv('/loja/', 'Loja completa', `${SITE}/`);
    if (chance(0.08))
      events.push({
        ...base(`${SITE}/`),
        type: 'identify',
        userId: `cliente-${i}`,
        attrs: { plano: pick(['free', 'pro']) },
      });
    t += Math.round(DAY * (1 + rand() * 4));
  }
}

events.sort((a, b) => (a.ts as number) - (b.ts as number));
const sessionsByVisitor = new Map<unknown, Set<unknown>>();
for (const e of events) {
  if (e.type !== 'pageview') continue;
  const s = sessionsByVisitor.get(e.visitorId) ?? new Set();
  s.add(e.sessionId);
  sessionsByVisitor.set(e.visitorId, s);
}
if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(events));
const returning = [...sessionsByVisitor.values()].filter((s) => s.size > 1).length;
for (let i = 0; i < (DRY ? 0 : events.length); i += 60)
  await call('/collect', { method: 'POST', body: JSON.stringify({ events: events.slice(i, i + 60) }) });
console.log(
  `[seed:data] ${VISITORS} visitantes (${returning} recorrentes), ${events.length} eventos enviados para ${API} (experimento ${KEY}).`,
);
