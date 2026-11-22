import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const apiPort = Number(process.env.KOVAN_PORT || 4700);
const apiOrigin = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'web/index.html'),
        phone: path.resolve(__dirname, 'web/phone.html'),
      },
    },
  },
  plugins: [{
    name: 'kovan-token',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (html.includes('name="kovan-phone"') || html.includes('name="kovan-token"')) return html;
        const file = process.env.KOVAN_TOKEN_FILE
          || path.join(process.env.KOVAN_DATA || path.resolve(__dirname, 'data'), 'token');
        let token = '';
        try { token = fs.readFileSync(file, 'utf8').trim(); } catch { token = ''; }
        if (!/^[a-f0-9]{64}$/i.test(token)) return html;
        return html.replace('<head>', `<head>\n  <meta name="kovan-token" content="${token}" />`);
      },
    },
  }],
  server: {
    port: 5180,
    fs: { allow: [path.resolve(__dirname)] },
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => { proxyReq.setHeader('origin', apiOrigin); });
        },
      },
    },
  },
});
