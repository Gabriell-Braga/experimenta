// Deploy completo na Cloudflare: API (Worker + D1 + KV), editor e demo (Workers com arquivos estáticos).
// Uso: pnpm deploy:cf  (precisa de `wrangler login`; recursos e segredos: ver docs/DEPLOY.md)
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { compileAccountScript } from '../apps/api/src/cdn';

const SUB = process.env.CF_SUBDOMAIN ?? 'hub-villa-deli';
const API = `https://abtest-api.${SUB}.workers.dev`;
const EDITOR = `https://abtest-editor.${SUB}.workers.dev`;
const root = join(import.meta.dirname, '..');

const run = (cmd: string, cwd = root, env: Record<string, string> = {}) => {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, {
    cwd,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  }).toString();
};
// wrangler é dependência da API; os outros Workers são implantados com -c apontando para a config deles.
const wrangler = (args: string) => run(`pnpm exec wrangler ${args}`, join(root, 'apps/api'));

// 1) Bundles do site (snippet + agent) na KV da CDN; recompila as configs já publicadas com o runtime novo.
run('pnpm --filter @abtest/snippet build');
run('pnpm --filter @abtest/agent build');
run('pnpm --filter @abtest/insights build');
wrangler('kv key put abt.js --binding CDN --remote --path ../../packages/snippet/dist/abt.js');
wrangler('kv key put agent.js --binding CDN --remote --path ../../packages/agent/dist/agent.js');
wrangler('kv key put insights.js --binding CDN --remote --path ../../packages/insights/dist/insights.js');
const runtime = readFileSync(join(root, 'packages/snippet/dist/abt.js'), 'utf8');
const keys = JSON.parse(wrangler('kv key list --binding CDN --remote')) as { name: string }[];
for (const { name } of keys.filter((k) => k.name.endsWith('.json'))) {
  const config = JSON.parse(wrangler(`kv key get ${name} --binding CDN --remote --text`));
  const tmp = join(root, 'apps/api', '.tmp-account.js');
  writeFileSync(tmp, compileAccountScript(config, runtime));
  wrangler(`kv key put ${name.replace(/\.json$/, '.js')} --binding CDN --remote --path .tmp-account.js`);
  rmSync(tmp);
}

// 2) API.
wrangler('d1 migrations apply abtest-db --remote');
wrangler('deploy');

// 3) Extensão (ponte injetada só no editor publicado) → zip baixável pelo editor.
run('pnpm --filter @abtest/extension build', root, { EDITOR_ORIGINS: `${EDITOR},http://localhost:5173` });
const extDir = join(root, 'apps/extension/dist');
const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(extDir, p).replace(/\\/g, '/')] = readFileSync(p);
  }
};
walk(extDir);

// 4) Editor e demo apontando para a API publicada.
run('pnpm --filter @abtest/editor build', root, { VITE_API_URL: API });
writeFileSync(join(root, 'apps/editor/dist/abtest-extension.zip'), zipSync(files));
wrangler('deploy -c ../editor/wrangler.jsonc');
run('pnpm --filter @abtest/demo build', root, { VITE_API_URL: API });
wrangler('deploy -c ../demo/wrangler.jsonc');

console.log(
  `\nPronto:\n  editor: ${EDITOR}\n  demo:   https://abtest-demo.${SUB}.workers.dev\n  API:    ${API}/docs`,
);
