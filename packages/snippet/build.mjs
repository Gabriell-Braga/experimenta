// Gera dist/abt.js (IIFE minificado) e informa o tamanho gzip.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'dist/abt.js',
  legalComments: 'none',
});
const code = readFileSync('dist/abt.js');
console.log(`[snippet] dist/abt.js ${code.length} B, gzip ${gzipSync(code, { level: 9 }).length} B`);
