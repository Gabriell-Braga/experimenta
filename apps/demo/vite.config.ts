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

export default defineConfig({
  plugins: [react(), spaFallback],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        produto: resolve(__dirname, 'produto.html'),
        obrigado: resolve(__dirname, 'obrigado.html'),
        spa: resolve(__dirname, 'spa/index.html'),
      },
    },
  },
});
