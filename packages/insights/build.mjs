// Gera dist/insights.js (IIFE): carregado sob demanda pelo snippet só para visitantes amostrados
// (gravação de sessão e formulários). Fica fora do runtime principal para não pesar nos outros.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'dist/insights.js',
  legalComments: 'none',
});
const gz = gzipSync(readFileSync('dist/insights.js'), { level: 9 }).length;
console.log(`[insights] dist/insights.js gzip ${gz} B`);
