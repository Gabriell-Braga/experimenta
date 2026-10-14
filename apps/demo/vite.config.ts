import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Em dev, qualquer sub-rota /spa/* devolve spa/index.html (history API fallback só da SPA).
const spaFallback: Plugin = {
  name: 'spa-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/spa(\/[^.]*)?$/.test(req.url.split('?')[0]!)) req.url = '/spa/index.html';
      next();
    });
  },
};

// /bloqueado/*: simula site que proíbe ser emoldurado (testa o fallback pela extensão).
const blockFraming: Plugin = {
  name: 'block-framing',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/bloqueado/')) {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), spaFallback, blockFraming],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        produto: resolve(__dirname, 'produto.html'),
        obrigado: resolve(__dirname, 'obrigado.html'),
        spa: resolve(__dirname, 'spa/index.html'),
        bloqueadoComSnippet: resolve(__dirname, 'bloqueado/com-snippet.html'),
        bloqueadoSemSnippet: resolve(__dirname, 'bloqueado/sem-snippet.html'),
      },
    },
  },
});
