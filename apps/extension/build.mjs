// Gera dist/ carregável em chrome://extensions (modo desenvolvedor → "Carregar sem compactação").
// EDITOR_ORIGINS (vírgulas) define em quais origins a ponte do app é injetada.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: { sw: 'src/sw.ts', bridge: 'src/bridge.ts', content: 'src/content.ts' },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'dist',
});
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const origins = (process.env.EDITOR_ORIGINS ?? 'http://localhost:5173').split(',');
manifest.content_scripts[0].matches = origins.map((o) => `${o}/*`);
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
console.log('[extension] dist/ pronto');
