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
// Bundles sob demanda (fora do limite abaixo): preview.js (link de pré-visualização, 17.3), qa.js (painel do
// modo QA, 21.7) e edit.js (handshake do modo edição).
for (const [entry, out] of [
  ['src/preview.ts', 'dist/preview.js'],
  ['src/qa-entry.ts', 'dist/qa.js'],
  ['src/edit-entry.ts', 'dist/edit.js'],
])
  await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    outfile: out,
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
