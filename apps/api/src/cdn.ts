import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { PublishedConfig } from '@abtest/shared';
import type { Context } from 'hono';

/** Arquivo publicado por conta: config embutida + runtime (ver docs/DECISOES.md D-008). */
export function compileAccountScript(config: PublishedConfig, runtimeJs: string): string {
  // `<` escapado: o JSON pode conter HTML de operações e não deve fechar <script> se for inline.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__ABT_CONFIG__=${json};\n${runtimeJs}`;
}

export function writeAccountFiles(cdnDir: string, config: PublishedConfig): void {
  mkdirSync(cdnDir, { recursive: true });
  const runtime = readFileSync(join(cdnDir, 'abt.js'), 'utf8');
  // Grava o .js por último: é o que o site carrega; o .json é o contrato para integrações.
  writeFileSync(join(cdnDir, `${config.accountId}.json`), JSON.stringify(config, null, 2));
  writeFileSync(join(cdnDir, `${config.accountId}.js`), compileAccountScript(config, runtime));
}

/** Copia os bundles compilados (snippet e agent) para a pasta da CDN local. */
export function syncBundles(cdnDir: string, repoRoot: string): void {
  mkdirSync(cdnDir, { recursive: true });
  for (const [src, dest] of [
    ['packages/snippet/dist/abt.js', 'abt.js'],
    ['packages/agent/dist/agent.js', 'agent.js'],
  ] as const) {
    const from = join(repoRoot, src);
    if (existsSync(from)) copyFileSync(from, join(cdnDir, dest));
  }
}

const TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Serve a pasta da CDN: só leitura, cache curto + ETag (publicar sobrescreve os arquivos). */
export function serveCdn(cdnDir: string) {
  const root = resolve(cdnDir);
  return (c: Context) => {
    const name = c.req.param('file') ?? '';
    const file = resolve(root, name);
    if (!file.startsWith(root + sep) || !/^[\w.-]+$/.test(name) || !TYPES[extname(file)] || !existsSync(file))
      return c.text('não encontrado', 404);
    const body = readFileSync(file);
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, max-age=60');
    c.header('Access-Control-Allow-Origin', '*');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    c.header('Content-Type', TYPES[extname(file)]!);
    return c.body(body);
  };
}
