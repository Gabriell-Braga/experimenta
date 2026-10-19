// Gera dist/index.js (ESM, sem dependências): SDK para Node, Deno, Workers e navegador.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  outfile: 'dist/index.js',
  legalComments: 'none',
});
console.log('[sdk] dist/index.js');
