// Gera dist/engage.js (IIFE): carregado sob demanda pelo snippet só quando há campanhas publicadas
// (pop-ups, barras e pesquisas). Fica fora do runtime principal para não pesar nos outros.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'dist/engage.js',
  legalComments: 'none',
});
const gz = gzipSync(readFileSync('dist/engage.js'), { level: 9 }).length;
console.log(`[engage] dist/engage.js gzip ${gz} B`);
