// Migração única (2026-10-20): os dados de demonstração que apontavam para o site simples do demo (home,
// produto.html, obrigado.html) passam a apontar para a loja (/loja/, /loja/checkout.html, /loja/obrigado.html),
// sem mexer em contagens: só URLs, páginas e seletores trocados por texto. Idempotente (rodar de novo não muda
// nada). Gravações reais (rrweb) ficam como estão: o DOM gravado é do site antigo.
// Uso: pnpm exec tsx scripts/migrar-demo-loja.ts → grava apps/api/.tmp-migrar.sql (D1) e .tmp-demo.json (KV).
// Aplicar (ver docs/PENDENCIAS.md): backup com `wrangler d1 export`, `wrangler d1 execute abtest-db --remote
// --file=.tmp-migrar.sql`, `wrangler kv key put demo.json --path .tmp-demo.json` e `pnpm deploy:cf`.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const api = join(import.meta.dirname, '../apps/api');
const HOSTS = [
  'https://experimenta-demo.gabrielbraga.app',
  'http://experimenta-demo.gabrielbraga.app',
  'https://abtest-demo.hub-villa-deli.workers.dev',
];

/** Trocas por texto, na ordem. Nenhum "para" contém o "de" (idempotente). */
const SWAPS: [string, string][] = [
  ...HOSTS.flatMap((h): [string, string][] => [
    [`${h}/produto.html`, `${h}/loja/checkout.html`],
    [`${h}/produto`, `${h}/loja/checkout`],
    [`${h}/obrigado.html`, `${h}/loja/obrigado.html`],
    [`${h}/obrigado`, `${h}/loja/obrigado`],
    [`${h}/"`, `${h}/loja/"`],
    [`${h}/?`, `${h}/loja/?`],
    [`${h}/#`, `${h}/loja/#`],
  ]),
  ['"/produto.html', '"/loja/checkout.html'],
  [' /produto.html', ' /loja/checkout.html'],
  ['"/produto"', '"/loja/checkout"'],
  ['"/obrigado.html', '"/loja/obrigado.html'],
  ['"/obrigado"', '"/loja/obrigado"'],
  ['"page":"/"', '"page":"/loja/"'],
  ['cta-comprar', 'hero-cta'],
  ['#hero-title', '#hero-track > article:first-child .hero__text'],
  ['#hero > img', '#hero-headline'],
  ['body > header > nav > a:nth-of-type(2)', '.mainnav__item:nth-of-type(2) > a'],
  ['#add-to-cart', '#pay'],
  ['h1.product-title', '#checkout-title'],
  ['"main > h1"', '"#thanks-title"'],
  ['Adicionar ao carrinho (frete grátis)', 'Pagar agora (frete grátis)'],
  ['Tênis Runner X · troca grátis em 30 dias', 'Finalize seu pedido · troca grátis em 30 dias'],
  ['"title":"Produto | Loja Demo"', '"title":"Checkout · Passo Firme"'],
  ['"title":"Obrigado | Loja Demo"', '"title":"Pedido confirmado · Passo Firme"'],
  ['"title":"Produto · Loja Demo"', '"title":"Checkout · Passo Firme"'],
  ['"title":"Obrigado · Loja Demo"', '"title":"Pedido confirmado · Passo Firme"'],
  ['"title":"Loja Demo"', '"title":"Passo Firme · Tênis e acessórios para correr"'],
  ['"name":"Home"', '"name":"Vitrine"'],
  ['"name":"Produto"', '"name":"Checkout"'],
  ['Home: chamada \\"Corra mais\\"', 'Loja: chamada \\"Corra mais\\"'],
  ['Home: chamada "Corra mais"', 'Loja: chamada "Corra mais"'],
  ['Produto: selo de frete grátis', 'Checkout: selo de frete grátis'],
  ['Home: botão com urgência', 'Loja: botão com urgência'],
  ['Home: newsletter com cupom', 'Loja: newsletter com cupom'],
  ['Funil: confiança do produto ao obrigado', 'Funil: confiança do checkout ao obrigado'],
  ['Compra pela home', 'Compra pela vitrine'],
  ['Testes da home', 'Testes do topo da loja'],
];

const swap = (s: string) => SWAPS.reduce((acc, [a, b]) => acc.split(a).join(b), s);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const acc = `account_id = 'demo'`;
// O parser do SQLite estoura com ~45 replace() aninhados: blocos de 10, cada um só nas linhas que contêm
// algum dos textos (o D1 conta cada linha regravada no limite diário de escrita).
const CHUNKS = Array.from({ length: Math.ceil(SWAPS.length / 10) }, (_, i) =>
  SWAPS.slice(i * 10, i * 10 + 10),
);
const update = (table: string, col: string, where = acc) =>
  CHUNKS.map((chunk) => {
    const e = chunk.reduce((x, [a, b]) => `replace(${x}, ${q(a)}, ${q(b)})`, col);
    const any = chunk.map(([a]) => `instr(${col}, ${q(a)}) > 0`).join(' OR ');
    return `UPDATE ${table} SET ${col} = ${e} WHERE ${where} AND (${any});`;
  });
// Página normalizada (origin + caminho, sem barra final, como normalizePage grava).
const PAGES = HOSTS.flatMap((h): [string, string][] => [
  [h, `${h}/loja`],
  [`${h}/produto.html`, `${h}/loja/checkout.html`],
  [`${h}/produto`, `${h}/loja/checkout`],
  [`${h}/obrigado.html`, `${h}/loja/obrigado.html`],
  [`${h}/obrigado`, `${h}/loja/obrigado`],
]);

const sql = [
  `UPDATE events SET page = CASE page ${PAGES.map(([a, b]) => `WHEN ${q(a)} THEN ${q(b)}`).join(' ')} END WHERE ${acc} AND page IN (${PAGES.map(([a]) => q(a)).join(', ')});`,
  ...update('events', 'payload'),
  ...['segmentation', 'editor_url', 'options', 'name'].flatMap((c) => update('experiments', c)),
  ...['operations', 'extra'].flatMap((c) => update('variations', c)),
  ...update('goals', 'definition'),
  ...update('experiment_versions', 'snapshot'),
  ...update('publications', 'config'),
  ...['data', 'name'].flatMap((c) =>
    update('entities', c, `${acc} AND kind NOT IN ('crm', 'export', 'export-state', 'webhook')`),
  ),
  // editor_url é texto puro (sem aspas): a home não casa com as trocas acima.
  `UPDATE experiments SET editor_url = editor_url || 'loja/' WHERE ${acc} AND editor_url IN (${HOSTS.map((h) => q(`${h}/`)).join(', ')});`,
  `UPDATE projects SET site_url = site_url || 'loja/', name = 'Passo Firme (loja)' WHERE ${acc} AND site_url NOT LIKE '%/loja/';`,
].join('\n');
writeFileSync(join(api, '.tmp-migrar.sql'), sql);

// Config publicada na CDN (o .js da conta é recompilado a partir dela no `pnpm deploy:cf`).
const kv = execSync('pnpm exec wrangler kv key get demo.json --binding CDN --remote --text', {
  cwd: api,
  stdio: ['inherit', 'pipe', 'inherit'],
}).toString();
writeFileSync(join(api, '.tmp-demo.json'), swap(JSON.stringify(JSON.parse(kv))));
console.log('Gerados apps/api/.tmp-migrar.sql e apps/api/.tmp-demo.json');
