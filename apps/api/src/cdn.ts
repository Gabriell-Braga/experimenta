import type { PublishedConfig } from '@abtest/shared';
import type { Context } from 'hono';
import { sha1 } from './crypto';

/** Armazenamento da CDN: pasta local (Node) ou KV (Cloudflare). */
export interface CdnStore {
  get(name: string): Promise<string | null>;
  put(name: string, body: string): Promise<void>;
}

/** Arquivo publicado por conta: config embutida + runtime (ver docs/DECISOES.md D-008). */
export function compileAccountScript(config: PublishedConfig, runtimeJs: string): string {
  // `<` escapado: o JSON pode conter HTML de operações e não deve fechar <script> se for inline.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__ABT_CONFIG__=${json};\n${runtimeJs}`;
}

export async function writeAccountFiles(store: CdnStore, config: PublishedConfig): Promise<void> {
  const runtime = (await store.get('abt.js')) ?? '';
  // .js (o que o site carrega) e .json (contrato para integrações) em paralelo: na KV cada escrita custa caro.
  await Promise.all([
    store.put(`${config.accountId}.json`, JSON.stringify(config, null, 2)),
    store.put(`${config.accountId}.js`, compileAccountScript(config, runtime)),
  ]);
}

const TYPES: Record<string, string> = {
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/** Serve a CDN: só leitura, cache curto + ETag (publicar sobrescreve os arquivos). */
export function serveCdn(store: CdnStore) {
  return async (c: Context) => {
    const name = c.req.param('file') ?? '';
    const type = TYPES[name.split('.').pop() ?? ''];
    const body = /^[\w.-]+$/.test(name) && !name.startsWith('.') && type ? await store.get(name) : null;
    if (body === null) return c.text('não encontrado', 404);
    const etag = `"${await sha1(body)}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, max-age=60');
    c.header('Access-Control-Allow-Origin', '*');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    c.header('Content-Type', type!);
    return c.body(body);
  };
}
