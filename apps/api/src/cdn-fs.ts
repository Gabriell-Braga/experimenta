import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { CdnStore } from './cdn';

/** CDN simulada por pasta servida estaticamente (dev/self-host). */
export function fsCdnStore(dir: string): CdnStore {
  const root = resolve(dir);
  const path = (name: string) => {
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) throw new Error('caminho fora da CDN');
    return file;
  };
  return {
    async get(name) {
      const file = path(name);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    async put(name, body) {
      mkdirSync(root, { recursive: true });
      writeFileSync(path(name), body);
    },
  };
}

/** Copia os bundles compilados (snippet, preview, agent, insights e engage) para a pasta da CDN local. */
export function syncBundles(cdnDir: string, repoRoot: string): void {
  mkdirSync(cdnDir, { recursive: true });
  for (const [src, dest] of [
    ['packages/snippet/dist/abt.js', 'abt.js'],
    ['packages/snippet/dist/preview.js', 'preview.js'],
    ['packages/agent/dist/agent.js', 'agent.js'],
    ['packages/insights/dist/insights.js', 'insights.js'],
    ['packages/engage/dist/engage.js', 'engage.js'],
  ] as const) {
    const from = join(repoRoot, src);
    if (existsSync(from)) copyFileSync(from, join(cdnDir, dest));
  }
}
