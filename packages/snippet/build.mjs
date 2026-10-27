// Gera dist/abt.js (IIFE minificado) e informa o tamanho gzip.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  // es2020 (D-102): ?. e ?? nativos; perde Safari < 13.1 e Chrome < 80.
  target: 'es2020',
  outfile: 'dist/abt.js',
  legalComments: 'none',
});
// preview.js: link de pré-visualização (17.3), carregado sob demanda pelo snippet; fora do limite abaixo.
await build({
  entryPoints: ['src/preview.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'dist/preview.js',
  legalComments: 'none',
});
const code = readFileSync('dist/abt.js');
const gz = gzipSync(code, { level: 9 }).length;
console.log(`[snippet] dist/abt.js ${code.length} B, gzip ${gz} B`);
// Meta do plano: runtime < 10 KB gzip (a config embutida é medida à parte).
const LIMIT = 10 * 1024;
if (gz > LIMIT) {
  console.error(`[snippet] ERRO: ${gz} B gzip excede o limite de ${LIMIT} B`);
  process.exit(1);
}
