import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** CSP do `_headers` (20.6): connect-src com a origem da API deste build (mesma regra de src/api.ts). */
function apiOriginInHeaders(): Plugin {
  let outDir = 'dist';
  return {
    name: 'abt-headers-api-origin',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const file = join(outDir, '_headers');
      const origin = new URL(process.env.VITE_API_URL ?? 'http://localhost:4000').origin;
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__API_ORIGIN__', origin));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiOriginInHeaders()],
  server: { port: 5173, strictPort: true },
});
