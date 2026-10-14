// Gera dist/agent.js (IIFE). Só é carregado no modo edição, então tamanho não é crítico.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/agent.js',
  legalComments: 'none',
});
console.log('[agent] dist/agent.js');
